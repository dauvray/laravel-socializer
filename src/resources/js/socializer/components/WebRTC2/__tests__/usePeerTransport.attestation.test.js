/**
 * usePeerTransport.attestation.test.js — obtention et rafraîchissement de l'attestation locale
 *
 * CE QUI EST FERMÉ ICI. Le chemin (a) de `_isAuthorizedIncomingPeer` admettait sur le seul
 * `metadata.from`, un champ que l'émetteur choisit. Le serveur signe désormais `{peerId, slug, exp}`
 * — le slug venant d'`Auth::user()` — et le porteur transporte l'attestation dans la `metadata` de
 * chaque connexion sortante. Ce fichier garde le versant ÉMETTEUR ; le versant récepteur (la
 * décision d'admission) est dans `usePeerTransport.incomingAuth.test.js`.
 *
 * ⚠️ **LE FAIT LE PLUS IMPORTANT DE CE FICHIER : l'attestation est posée AVANT que le `Peer`
 * n'existe.** C'est ce que garde `aucune fenêtre : le Peer n'existe jamais sans son attestation`, et
 * c'est ce qui rend le mécanisme utilisable. Le peerId est choisi par nous (`crypto.randomUUID()`),
 * donc l'attestation peut être demandée en parallèle de la configuration ICE. La demander à
 * l'`'open'` aurait laissé une fenêtre : le chemin « bail encore valide » de `useConnectionPool`
 * (navigation SPA, cas MAJORITAIRE) ouvre une connexion dès que `waitForMeReady` rend la main —
 * donc avant qu'une demande partie de l'`'open'` ne soit revenue. Ces connexions-là seraient
 * refusées sous `enforce`, par un refus que rien ne rattrape.
 *
 * ── ORDRE DES FAUX MINUTEURS ──────────────────────────────────────────────────────────────────
 *
 * Comme `iceRefresh.test.js` et pour la même raison : le minuteur à piloter est armé PENDANT
 * `_doInit`, donc `vi.useFakeTimers()` doit précéder le montage. Jouable parce que
 * `AjaxService.load` (mocké par `mockResolvedValue`) résout par MICROTÂCHE — l'invariant documenté
 * en tête de `fetchIceServers.js`, qui vaut mot pour mot pour `fetchPeerAttestation.js`.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-29 ────────────────────────
 *
 *   1. `setLocalPeerAttestation` retiré de `_doInit` ......................... 5 cas
 *   2. l'appel à `_scheduleAttestationRefresh` retiré de `_doInit` ........... 5 cas
 *   3. la garde « ne rien écrire quand le serveur n'a rien servi » désarmée .. 2 cas
 *   4. la garde d'identité post-`await` de `_refreshAttestation` retirée ..... 1 cas
 *
 * ℹ️ Les points 1 et 2 rougissent le même NOMBRE de cas mais pas les mêmes : le premier emporte la
 * pose initiale et tout ce qui la relit, le second les cinq cas de cadence. Deux mécanismes, deux
 * lignes, et aucune des deux n'est couverte par l'autre.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { bootLocalPeer, waitForPeerInstance } from './helpers/bootLocalPeer.js'
import {
    ATTESTATION_MAX_RETRIES,
    ATTESTATION_REFRESH_MARGIN_MS,
    ATTESTATION_REFRESH_MIN_DELAY_MS,
    ATTESTATION_RETRY_MS,
    ENDPOINTS,
    PEER_DESTROY_DELAY_MS,
} from '~socializer/components/WebRTC2/webrtc2.config.js'

const ROOM = 'live'

const ATTESTATION = 'charge.signature'
const ATTESTATION_FRAICHE = 'charge-fraiche.signature'

const TTL_SECONDES = 300
const ECHEANCE_MS = (TTL_SECONDES * 1000) - ATTESTATION_REFRESH_MARGIN_MS

/** Ce que la route d'attestation rend, mécanisme actif. */
const SERVIE = { attestation: ATTESTATION, attestation_ttl: TTL_SECONDES, enforce: false }

/** Ce qu'elle rend quand le mécanisme est inactif (aucun secret, aucune `APP_KEY`). */
const INACTIVE = { attestation: null, enforce: false }

const loadTransportCopy = async () => {
    vi.resetModules()

    const [{ usePeerTransport }, peerMock] = await Promise.all([
        import('~socializer/components/WebRTC2/Composables/usePeerTransport.js'),
        import('peerjs'),
    ])

    peerMock.resetPeerMock()

    return { usePeerTransport, lastPeer: peerMock.getLastPeerInstance }
}

describe('usePeerTransport — attestation du peerId local', () => {
    let apps

    beforeEach(() => {
        apps = []
        vi.spyOn(console, 'info').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'debug').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.useFakeTimers()
    })

    afterEach(() => {
        apps.forEach((app) => { try { app.unmount() } catch { /* déjà démontée */ } })
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    const makeCtx = (contextId) => createMockContext({
        contextId,
        session: { currentType: 'stream', currentRoom: ROOM },
        connection: { remotePeers: [] },
    })

    const mount = (usePeerTransport, ctx) => {
        const [api, app] = withSetup(() => usePeerTransport(ctx))
        apps.push(app)
        return [api, app]
    }

    /**
     * Une doublure qui distingue les DEUX routes de `_doInit`.
     *
     * ⚠️ Un `mockResolvedValue` unique servirait la même charge aux deux, et la réponse ICE ferait
     * alors une attestation absente — tous les cas ci-dessous verdiraient sur le chemin « mécanisme
     * inactif », sans jamais exercer le mécanisme.
     */
    const routes = (ctx, reponseAttestation) => {
        ctx.AjaxService.load.mockImplementation(async (endpoint) => (
            endpoint === ENDPOINTS.ATTEST_PEER_ID
                ? reponseAttestation
                : { iceServers: [{ urls: 'stun:stun.example:19302' }] }
        ))
    }

    /** Les appels réellement partis vers la route d'attestation, et eux seuls. */
    const demandes = (ctx) => ctx.AjaxService.load.mock.calls
        .filter(([endpoint]) => endpoint === ENDPOINTS.ATTEST_PEER_ID)

    const ouvrirPeer = async (reponseAttestation = SERVIE) => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('data-app')
        routes(ctx, reponseAttestation)

        const [api, app] = mount(usePeerTransport, ctx)
        const peer = await bootLocalPeer(
            () => api.setLocalPeer(),
            { peerId: 'peer-alice', getPeer: lastPeer, waitForInstance: waitForPeerInstance },
        )

        return { ctx, api, app, peer }
    }

    // ── L'obtention ──────────────────────────────────────────────────────────────

    it('pose l\'attestation servie par le serveur, et sa politique', async () => {
        const { ctx } = await ouvrirPeer({ ...SERVIE, enforce: true })

        expect(ctx.peerStore.localPeerAttestation).toBe(ATTESTATION)
        expect(ctx.peerStore.attestationEnforce).toBe(true)
    })

    it('fait attester le peerId RÉELLEMENT donné au constructeur du Peer', async () => {
        // Le lien qui fait tout : une attestation portant un autre id serait refusée par le
        // vérificateur d'en face, et ce refus serait indistinguable d'une usurpation.
        //
        // ⚠️ L'id est lu AVANT l'`'open'`, et il le faut : le harnais impose l'identité d'ouverture
        // (`bootLocalPeer(..., { peerId })`) alors que la production reçoit du serveur PeerJS
        // l'id qu'elle a elle-même fourni. Lire `peer.id` après l'`'open'` comparerait donc
        // l'attestation à une valeur de harnais, pas au contrat.
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('data-app')
        routes(ctx, SERVIE)

        const [api] = mount(usePeerTransport, ctx)
        api.setLocalPeer()
        await vi.advanceTimersByTimeAsync(0)

        expect(demandes(ctx)).toEqual([[ENDPOINTS.ATTEST_PEER_ID, 'post', { peerId: lastPeer().id }]])
    })

    it('aucune fenêtre : le Peer n\'existe jamais sans son attestation', async () => {
        // ⚠️ LE FAIT DE CE FICHIER. On tient la réponse d'attestation en vol et on vérifie
        // qu'AUCUN Peer n'a été construit entre-temps — donc qu'aucune connexion sortante n'a pu
        // partir sans identité vérifiable. C'est ce qui distingue cette implémentation d'une
        // demande faite à l'`'open'`, qui laisserait passer le chemin « bail encore valide » de
        // `useConnectionPool`.
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('data-app')

        let servirAttestation
        ctx.AjaxService.load.mockImplementation(async (endpoint) => (
            endpoint === ENDPOINTS.ATTEST_PEER_ID
                ? new Promise((resolve) => { servirAttestation = () => resolve(SERVIE) })
                : { iceServers: [{ urls: 'stun:stun.example:19302' }] }
        ))

        const [api] = mount(usePeerTransport, ctx)
        api.setLocalPeer()

        await vi.advanceTimersByTimeAsync(0)
        expect(lastPeer()).toBeNull()

        servirAttestation()
        await vi.advanceTimersByTimeAsync(0)

        // Le Peer n'apparaît qu'ensuite, et son attestation est déjà là.
        expect(lastPeer()).not.toBeNull()
        expect(ctx.peerStore.localPeerAttestation).toBe(ATTESTATION)
    })

    it('crée quand même le Peer quand le mécanisme est inactif côté serveur', async () => {
        // Le chemin NOMINAL d'un déploiement sans secret : l'admission d'en face retombe sur ce
        // qu'elle faisait avant l'attestation, et rien n'est armé. Une panne de cette route ne doit
        // jamais couper WebRTC dans l'onglet.
        const { ctx, peer } = await ouvrirPeer(INACTIVE)

        expect(peer).not.toBeNull()
        expect(ctx.peerStore.localPeerAttestation).toBeNull()
        expect(ctx.peerStore.attestationEnforce).toBe(false)
        expect(ctx.peerStore.peerAttestationRefreshTimer).toBeNull()
    })

    // ── Le rafraîchissement ──────────────────────────────────────────────────────

    it('arme un minuteur quand le serveur annonce une durée de vie', async () => {
        const { ctx } = await ouvrirPeer()

        expect(ctx.peerStore.peerAttestationRefreshTimer).not.toBeNull()
    })

    it('remplace l\'attestation à l\'échéance, et réarme', async () => {
        // Le cas d'usage réel : le contexte permanent `data-app`, monté au tick 0, jamais démonté.
        // Une attestation périmée vaut `null` chez le vérificateur — donc, sous `enforce`, un refus.
        const { ctx } = await ouvrirPeer()

        routes(ctx, { ...SERVIE, attestation: ATTESTATION_FRAICHE })

        await vi.advanceTimersByTimeAsync(ECHEANCE_MS - 1)
        expect(ctx.peerStore.localPeerAttestation).toBe(ATTESTATION)

        await vi.advanceTimersByTimeAsync(1)
        expect(ctx.peerStore.localPeerAttestation).toBe(ATTESTATION_FRAICHE)
        expect(ctx.peerStore.peerAttestationRefreshTimer).not.toBeNull()
    })

    it('plancher : un TTL plus court que la marge n\'arme pas une boucle chaude', async () => {
        // `attestation.ttl` est un réglage d'hôte : rien n'empêche un déployeur d'y mettre 30 s.
        // Sans plancher, `ttl - MARGE` serait négatif et `setTimeout` déclencherait immédiatement —
        // une boucle chaude sur une route privée ET plafonnée, donc une avalanche de 429 qui
        // priverait l'onglet de toute attestation.
        const { ctx } = await ouvrirPeer({ ...SERVIE, attestation_ttl: 30 })

        expect(demandes(ctx)).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(ATTESTATION_REFRESH_MIN_DELAY_MS - 1)
        expect(demandes(ctx)).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(1)
        expect(demandes(ctx)).toHaveLength(2)
    })

    it('conserve l\'attestation en place quand le rafraîchissement ne rapporte rien', async () => {
        // 🔥 Le piège propre à ce mécanisme, et il mord plus fort que son homologue ICE : une
        // configuration ICE dégradée retombe sur STUN — ça marche encore —, tandis qu'une
        // attestation effacée fait REFUSER, sous `enforce`, un pair admis la seconde d'avant.
        const { ctx } = await ouvrirPeer()

        ctx.AjaxService.load.mockRejectedValue(new Error('500'))
        await vi.advanceTimersByTimeAsync(ECHEANCE_MS)

        expect(ctx.peerStore.localPeerAttestation).toBe(ATTESTATION)
    })

    it('reprend après un échec, puis abandonne au plafond sans marteler la route', async () => {
        const { ctx } = await ouvrirPeer()

        ctx.AjaxService.load.mockRejectedValue(new Error('500'))
        await vi.advanceTimersByTimeAsync(ECHEANCE_MS)

        expect(ctx.peerStore.peerAttestationAttempts).toBe(1)
        expect(ctx.peerStore.peerAttestationRefreshTimer).not.toBeNull()

        for (let tentative = 2; tentative <= ATTESTATION_MAX_RETRIES; tentative += 1) {
            await vi.advanceTimersByTimeAsync(ATTESTATION_RETRY_MS)
            expect(ctx.peerStore.peerAttestationAttempts).toBe(tentative)
        }

        // Au plafond : plus rien n'est armé. La dégradation assumée est le retour au comportement
        // d'avant — l'admission d'en face redevient non corroborée, et un F5 renouvelle.
        expect(ctx.peerStore.peerAttestationRefreshTimer).toBeNull()
        expect(demandes(ctx)).toHaveLength(1 + ATTESTATION_MAX_RETRIES)

        await vi.advanceTimersByTimeAsync(ECHEANCE_MS * 4)
        expect(demandes(ctx)).toHaveLength(1 + ATTESTATION_MAX_RETRIES)
    })

    // ── Le minuteur meurt avec son Peer ──────────────────────────────────────────

    it('n\'écrit rien quand le Peer visé a été supplanté pendant la récupération', async () => {
        // Écrire au retour poserait, pour l'identité courante, une attestation signée pour un
        // peerId disparu — donc un refus systématique chez TOUS les récepteurs, indistinguable
        // d'une usurpation. La supplantation est simulée par l'écriture directe de
        // `peerStore.localPeer`, parce que c'est littéralement ce que fait une init concurrente.
        const { ctx } = await ouvrirPeer()

        let servir
        ctx.AjaxService.load.mockReturnValue(
            new Promise((resolve) => { servir = () => resolve({ ...SERVIE, attestation: ATTESTATION_FRAICHE }) }),
        )
        await vi.advanceTimersByTimeAsync(ECHEANCE_MS)
        expect(demandes(ctx)).toHaveLength(2)

        ctx.peerStore.localPeer = { est: 'un autre Peer' }

        servir()
        await vi.advanceTimersByTimeAsync(0)

        expect(ctx.peerStore.localPeerAttestation).toBe(ATTESTATION)
        // Et surtout : aucun réarmement. Le Peer courant arme le sien.
        expect(ctx.peerStore.peerAttestationRefreshTimer).toBeNull()
    })

    it('cesse d\'interroger la route dès que le Peer singleton est détruit', async () => {
        const { ctx, app } = await ouvrirPeer()

        app.unmount()
        await vi.advanceTimersByTimeAsync(PEER_DESTROY_DELAY_MS)

        // `resetPeerState` annule le minuteur ET oublie l'attestation : elle décrit un peerId qui
        // n'existe plus.
        expect(ctx.peerStore.peerAttestationRefreshTimer).toBeNull()
        expect(ctx.peerStore.localPeerAttestation).toBeNull()

        await vi.advanceTimersByTimeAsync(ECHEANCE_MS * 4)
        expect(demandes(ctx)).toHaveLength(1)
    })
})
