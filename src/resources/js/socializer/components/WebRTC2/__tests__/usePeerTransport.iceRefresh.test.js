/**
 * usePeerTransport.iceRefresh.test.js — Rafraîchissement du credential TURN
 *
 * LE DÉFAUT FERMÉ ICI. Le credential TURN est éphémère (TURN REST API, TTL annoncé par
 * `credential_ttl`), mais la configuration ICE n'était récupérée qu'UNE FOIS par cycle de vie du
 * `Peer` — lequel est un singleton d'onglet que rien ne détruit tant que la coquille SPA vit. Passé
 * le TTL, l'appel en cours tenait (coturn a déjà sa clé de session) mais TOUTE NOUVELLE ALLOCATION
 * échouait : « la visio ne passe plus, un F5 la répare ».
 *
 * CE QUI EST ÉPINGLÉ, et l'ordre importe :
 *   1. le minuteur est armé, et son échéance réécrit `peer.options.config` — le seul objet que
 *      PeerJS relit à chaque connexion ;
 *   2. il n'est PAS armé quand il n'y a rien à rafraîchir (invité, mode statique, repli STUN) ;
 *   3. un rafraîchissement infructueux NE DÉGRADE PAS la configuration en place — c'est le piège
 *      propre à ce mécanisme, puisque `fetchIceServers` rend le repli STUN quand la route meurt ;
 *   4. il ne touche pas au `Peer` lui-même : ni destruction, ni reconnexion, donc aucune connexion
 *      ouverte perturbée ;
 *   5. il meurt avec le `Peer` qu'il vise.
 *
 * ── ORDRE DES FAUX MINUTEURS, ET POURQUOI IL EST INVERSE DE `singleton.test.js` ────────────────
 *
 * Là-bas, `vi.useFakeTimers()` vient APRÈS le lancement de `setLocalPeer` — sinon le `setTimeout`
 * de `fetchIceServers` deviendrait pilotable et ferait sortir la récupération en repli.
 *
 * Ici c'est l'inverse : le minuteur qu'on veut piloter est armé PENDANT `_doInit`, donc les faux
 * minuteurs doivent déjà être en place à ce moment-là. Ce n'est jouable que parce que
 * `AjaxService.load` (mocké par `mockResolvedValue`) résout par MICROTÂCHE : le `Promise.race` de
 * `fetchIceServers` se règle sans qu'aucun minuteur n'ait à s'écouler. C'est exactement l'invariant
 * documenté en tête de `fetchIceServers.js` — le remplacer par une doublure à base de `setTimeout`
 * figerait tout ce fichier.
 *
 * ⚠️ COROLLAIRE, et il a déjà mordu : **toute avance de plus de `ICE_FETCH_TIMEOUT_MS` (3 s) faite
 * pendant qu'une récupération est en vol la fait sortir en repli.** Un test qui écoule
 * `PEER_DESTROY_DELAY_MS` (10 s) pour détruire le Peer « pendant » la requête ne mesure donc pas ce
 * qu'il croit : la requête est déjà retombée en STUN, et il verdit sur la garde « pas de TTL ⇒ pas
 * d'écriture » sans jamais exercer la garde d'identité. Cf. le test de supplantation plus bas.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-25 ─────────────────────────
 *
 * Six neutralisations, chacune rougissant exactement ce qu'elle doit :
 *   1. l'appel à `_scheduleIceRefresh` retiré de `_doInit` ................... 8 cas
 *   2. le repli écrit malgré tout (garde « TTL nul » désarmée) ............... 4 cas
 *   3. la garde d'identité post-`await` retirée .............................. 1 cas (supplantation)
 *   4. plancher et plafond du délai retirés .................................. 2 cas
 *   5. `resetIceRefreshAttempts()` retiré ................................... 1 cas
 *   6. `clearIceRefreshTimer()` retiré du `resetPeerState` de la DOUBLURE .... 1 cas
 *
 * ⚠️ Le point 6 porte sur `helpers/createMockContext.js`, PAS sur le store réel : le retirer de
 * `stores/peers2/actions.js` laisse ce fichier entièrement vert. `mockFidelity.test.js` ne garantit
 * que la SURFACE de la doublure, jamais que son `resetPeerState` fasse la même chose que le vrai.
 * Le versant store est donc épinglé ailleurs — `peers2Store.peerRuntime.test.js` — et les deux sont
 * nécessaires.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { bootLocalPeer, waitForPeerInstance } from './helpers/bootLocalPeer.js'
import { PEER_PHASES } from '~socializer/stores/peers2/phases.js'
import {
    ENDPOINTS,
    ICE_REFRESH_MARGIN_MS,
    ICE_REFRESH_MAX_DELAY_MS,
    ICE_REFRESH_MAX_RETRIES,
    ICE_REFRESH_MIN_DELAY_MS,
    ICE_REFRESH_RETRY_MS,
    PEER_DESTROY_DELAY_MS,
    STUN_ONLY_ICE_SERVERS,
} from '~socializer/components/WebRTC2/webrtc2.config.js'

const ROOM = 'live'

/** La configuration servie par la route, avec relais. */
const ICE = [
    { urls: 'stun:stun.example:19302' },
    { urls: 'turn:turn.example:3478', username: '1800:42', credential: 'c-42' },
]

/** Celle du rafraîchissement — un credential distinct, pour que la réécriture soit observable. */
const ICE_FRAIS = [
    { urls: 'stun:stun.example:19302' },
    { urls: 'turn:turn.example:3478', username: '5400:42', credential: 'c-42-frais' },
]

const TTL_SECONDES = 3600
const TTL_MS = TTL_SECONDES * 1000
/** Ce que `_scheduleIceRefresh` doit calculer pour ce TTL. */
const ECHEANCE_MS = TTL_MS - ICE_REFRESH_MARGIN_MS

const loadTransportCopy = async () => {
    vi.resetModules()

    const [{ usePeerTransport }, peerMock] = await Promise.all([
        import('~socializer/components/WebRTC2/Composables/usePeerTransport.js'),
        import('peerjs'),
    ])

    peerMock.resetPeerMock()

    return { usePeerTransport, lastPeer: peerMock.getLastPeerInstance }
}

describe('usePeerTransport — rafraîchissement du credential TURN', () => {
    let apps

    beforeEach(() => {
        apps = []
        vi.spyOn(console, 'info').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
        // Cf. l'avertissement en tête de fichier : AVANT le montage, contrairement à
        // `singleton.test.js`.
        vi.useFakeTimers()
    })

    afterEach(() => {
        apps.forEach((app) => { try { app.unmount() } catch { /* déjà démontée */ } })
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    const makeCtx = (contextId, sharedPeerStore = null) => {
        const ctx = createMockContext({
            contextId,
            session: { currentType: 'stream', currentRoom: ROOM },
            connection: { remotePeers: [] },
        })
        return sharedPeerStore ? { ...ctx, peerStore: sharedPeerStore } : ctx
    }

    const mount = (usePeerTransport, ctx) => {
        const [api, app] = withSetup(() => usePeerTransport(ctx))
        apps.push(app)
        return [api, app]
    }

    /**
     * Monte un contexte, ouvre le Peer, et rend de quoi piloter la suite.
     *
     * @param {Object} reponseInitiale Ce que la route rend au fetch de `_doInit`
     */
    const ouvrirPeer = async (reponseInitiale) => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('data-app')
        ctx.AjaxService.load.mockResolvedValue(reponseInitiale)

        const [api, app] = mount(usePeerTransport, ctx)
        const peer = await bootLocalPeer(
            () => api.setLocalPeer(),
            { peerId: 'peer-alice', getPeer: lastPeer, waitForInstance: waitForPeerInstance },
        )

        return { ctx, api, app, peer }
    }

    /**
     * Combien de fois `/get-ice-servers` a été interrogée — et rien d'autre.
     *
     * ⚠️ Compter les appels de `AjaxService.load` TOUS ENDPOINTS CONFONDUS coupait ce fichier de son
     * sujet. `_doInit` interroge désormais aussi la route d'attestation, en parallèle de celle-ci :
     * onze assertions de cadence sont devenues fausses d'un cran, pour une raison qui n'est celle
     * d'aucun de ces cas — et la prochaine route ajoutée les aurait cassées de nouveau. Ce que ces
     * tests mesurent est la cadence d'interrogation de la route ICE, elle seule.
     */
    const appelsIce = (ctx) => ctx.AjaxService.load.mock.calls
        .filter(([endpoint]) => endpoint === ENDPOINTS.ICE_SERVERS).length

    // ── Le mécanisme ─────────────────────────────────────────────────────────────

    it('arme un minuteur quand la route annonce un credential périssable', async () => {
        const { ctx } = await ouvrirPeer({ iceServers: ICE, credential_ttl: TTL_SECONDES })

        expect(ctx.peerStore.peerIceRefreshTimer).not.toBeNull()
    })

    it('réécrit `peer.options.config` à l\'échéance, sans toucher au Peer', async () => {
        const { ctx, peer } = await ouvrirPeer({ iceServers: ICE, credential_ttl: TTL_SECONDES })

        ctx.AjaxService.load.mockResolvedValue({ iceServers: ICE_FRAIS, credential_ttl: TTL_SECONDES })

        // Rien avant l'échéance : un rafraîchissement précoce serait une requête pour rien à chaque
        // tick, et le plafond de `/get-ice-servers` est justement dimensionné sur « une par TTL ».
        await vi.advanceTimersByTimeAsync(ECHEANCE_MS - 1)
        expect(peer.options.config.iceServers).toEqual(ICE)

        await vi.advanceTimersByTimeAsync(1)

        // LE fait de ce fichier : c'est cet objet-ci que PeerJS relit dans
        // `new RTCPeerConnection(this.connection.provider.options.config)`, à chaque connexion.
        expect(peer.options.config.iceServers).toEqual(ICE_FRAIS)
        expect(appelsIce(ctx)).toBe(2)
        expect(ctx.AjaxService.load).toHaveBeenLastCalledWith(ENDPOINTS.ICE_SERVERS, 'get')
    })

    it('ne perturbe aucune connexion ouverte : ni destruction, ni reconnexion', async () => {
        // La raison pour laquelle ce mécanisme peut être aussi petit : PeerJS relit `options.config`
        // à chaque NOUVELLE connexion, donc les connexions déjà négociées n'ont pas à être touchées.
        // Ce test épingle qu'on ne les touche effectivement pas — la tentation étant `setConfiguration()`
        // ou, pire, un cycle destroy → init pour « repartir propre ».
        const { ctx, peer } = await ouvrirPeer({ iceServers: ICE, credential_ttl: TTL_SECONDES })
        const connexionsAvant = ctx.peerStore.getConnections

        ctx.AjaxService.load.mockResolvedValue({ iceServers: ICE_FRAIS, credential_ttl: TTL_SECONDES })
        await vi.advanceTimersByTimeAsync(ECHEANCE_MS)

        expect(peer.destroy).not.toHaveBeenCalled()
        expect(peer.reconnect).not.toHaveBeenCalled()
        expect(peer.id).toBe('peer-alice')
        expect(ctx.peerStore.localPeer).toBe(peer)
        expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.READY)
        expect(ctx.peerStore.getConnections).toBe(connexionsAvant)
    })

    it('réarme après chaque rafraîchissement réussi — un onglet ouvert indéfiniment reste valide', async () => {
        // Le cas d'usage réel : le contexte permanent `data-app`, monté au tick 0, jamais démonté.
        // Un rafraîchissement unique n'aurait fait que déplacer la panne de 24 h.
        const { ctx } = await ouvrirPeer({ iceServers: ICE, credential_ttl: TTL_SECONDES })

        ctx.AjaxService.load.mockResolvedValue({ iceServers: ICE_FRAIS, credential_ttl: TTL_SECONDES })

        for (let cycle = 1; cycle <= 3; cycle += 1) {
            await vi.advanceTimersByTimeAsync(ECHEANCE_MS)
            expect(appelsIce(ctx)).toBe(cycle + 1)
        }
    })

    // ── Ce qui n'arme rien ───────────────────────────────────────────────────────

    it('n\'arme aucun minuteur quand la route n\'annonce pas de TTL (invité, mode statique)', async () => {
        // Non-régression du comportement d'avant ce mécanisme : un couple statique ne s'expire pas,
        // et un invité n'a aucune entrée TURN. Armer serait une requête par TTL pour réécrire la
        // même configuration.
        const { ctx } = await ouvrirPeer({ iceServers: ICE })

        expect(ctx.peerStore.peerIceRefreshTimer).toBeNull()

        await vi.advanceTimersByTimeAsync(ICE_REFRESH_MAX_DELAY_MS)
        expect(appelsIce(ctx)).toBe(1)
    })

    it('n\'arme aucun minuteur quand la configuration ICE est le repli STUN', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('data-app')
        ctx.AjaxService.load.mockRejectedValue(new Error('500'))

        const [api] = mount(usePeerTransport, ctx)
        // Jusqu'à l'`'open'`, comme partout ailleurs : l'assertion « aucun minuteur » doit
        // porter sur un Peer réellement ouvert, sinon elle deviendrait vraie pour la mauvaise
        // raison le jour où l'armement se déplacerait après l'`'open'`.
        const peer = await bootLocalPeer(
            () => api.setLocalPeer(),
            { peerId: 'peer-alice', getPeer: lastPeer, waitForInstance: waitForPeerInstance },
        )

        expect(peer.options.config.iceServers).toEqual(STUN_ONLY_ICE_SERVERS)
        expect(ctx.peerStore.peerIceRefreshTimer).toBeNull()
    })

    // ── Le piège : un rafraîchissement ne doit jamais dégrader ───────────────────

    it('conserve la configuration TURN quand le rafraîchissement ne rapporte rien d\'exploitable', async () => {
        // 🔥 Le piège propre à ce mécanisme. `fetchIceServers` ne jette jamais : quand la route
        // meurt, elle rend le repli STUN. Écrire ce repli remplacerait une configuration TURN QUI
        // MARCHE par une configuration sans relais — un rafraîchissement qui casse le relais, soit
        // l'exact contraire de ce qu'on installe.
        const { ctx, peer } = await ouvrirPeer({ iceServers: ICE, credential_ttl: TTL_SECONDES })

        ctx.AjaxService.load.mockRejectedValue(new Error('500'))
        await vi.advanceTimersByTimeAsync(ECHEANCE_MS)

        expect(peer.options.config.iceServers).toEqual(ICE)
        expect(peer.options.config.iceServers).not.toEqual(STUN_ONLY_ICE_SERVERS)
    })

    it('reprend après un échec, puis abandonne au plafond sans marteler la route', async () => {
        // Borné, et pas par politesse : `routes.public.php` documente que `/get-ice-servers` n'a pas
        // de `throttle`, et que la condition de réouverture est « un credential court ET
        // re-demandé ». Une reprise non bornée sur une route morte SERAIT ce re-demandé-là.
        const { ctx, peer } = await ouvrirPeer({ iceServers: ICE, credential_ttl: TTL_SECONDES })

        ctx.AjaxService.load.mockRejectedValue(new Error('500'))
        await vi.advanceTimersByTimeAsync(ECHEANCE_MS)

        // Première tentative infructueuse : une reprise est armée, à l'échelle de la minute et non
        // du TTL — le credential est déjà en train d'expirer, attendre le TTL suivant n'a pas de sens.
        expect(ctx.peerStore.peerIceRefreshAttempts).toBe(1)
        expect(ctx.peerStore.peerIceRefreshTimer).not.toBeNull()

        // Les reprises restantes jusqu'au plafond.
        for (let tentative = 2; tentative <= ICE_REFRESH_MAX_RETRIES; tentative += 1) {
            await vi.advanceTimersByTimeAsync(ICE_REFRESH_RETRY_MS)
            expect(ctx.peerStore.peerIceRefreshAttempts).toBe(tentative)
        }

        // Au plafond : plus rien n'est armé, et la configuration en place est intacte. La
        // dégradation assumée est le retour au comportement d'avant — un F5 renouvelle.
        expect(ctx.peerStore.peerIceRefreshTimer).toBeNull()
        expect(peer.options.config.iceServers).toEqual(ICE)
        expect(appelsIce(ctx)).toBe(1 + ICE_REFRESH_MAX_RETRIES)

        // Et rien ne repart tout seul ensuite.
        await vi.advanceTimersByTimeAsync(ICE_REFRESH_MAX_DELAY_MS)
        expect(appelsIce(ctx)).toBe(1 + ICE_REFRESH_MAX_RETRIES)
    })

    it('repart d\'un compte neuf après un rafraîchissement réussi', async () => {
        // Sans cette remise à zéro, trois échecs étalés sur des mois d'onglet ouvert — donc
        // entrecoupés de réussites — finiraient par abandonner définitivement.
        const { ctx } = await ouvrirPeer({ iceServers: ICE, credential_ttl: TTL_SECONDES })

        ctx.AjaxService.load.mockRejectedValue(new Error('500'))
        await vi.advanceTimersByTimeAsync(ECHEANCE_MS)
        expect(ctx.peerStore.peerIceRefreshAttempts).toBe(1)

        ctx.AjaxService.load.mockResolvedValue({ iceServers: ICE_FRAIS, credential_ttl: TTL_SECONDES })
        await vi.advanceTimersByTimeAsync(ICE_REFRESH_RETRY_MS)

        expect(ctx.peerStore.peerIceRefreshAttempts).toBe(0)
    })

    // ── Dimensionnement du délai ─────────────────────────────────────────────────

    it('plancher : un TTL plus court que la marge n\'arme pas une boucle chaude', async () => {
        // ⚠️ `credential_ttl` est un réglage d'hôte. Sans plancher, `ttl - marge` serait négatif et
        // `setTimeout` déclencherait IMMÉDIATEMENT — donc une requête par tick sur une route sans
        // `throttle`, une panne pire que celle qu'on ferme.
        const { ctx } = await ouvrirPeer({ iceServers: ICE, credential_ttl: 30 })

        ctx.AjaxService.load.mockResolvedValue({ iceServers: ICE_FRAIS, credential_ttl: 30 })

        await vi.advanceTimersByTimeAsync(ICE_REFRESH_MIN_DELAY_MS - 1)
        expect(appelsIce(ctx)).toBe(1)

        await vi.advanceTimersByTimeAsync(1)
        expect(appelsIce(ctx)).toBe(2)
    })

    it('plafond : un TTL démesuré est ramené sous la borne de `setTimeout`', async () => {
        // ⚠️ Au-delà de ~24,8 jours (2^31-1 ms), `setTimeout` ne repousse pas : il déclenche
        // IMMÉDIATEMENT. Un `COTURN_CREDENTIAL_TTL` réglé sur un mois — plausible pour qui veut « ne
        // plus y penser » — produirait donc le martèlement, par l'autre extrémité que le plancher.
        const TTL_UN_MOIS = 30 * 24 * 3600

        const { ctx } = await ouvrirPeer({ iceServers: ICE, credential_ttl: TTL_UN_MOIS })

        ctx.AjaxService.load.mockResolvedValue({ iceServers: ICE_FRAIS, credential_ttl: TTL_UN_MOIS })

        // Le point qui compte : il n'a PAS déjà tiré.
        expect(appelsIce(ctx)).toBe(1)

        await vi.advanceTimersByTimeAsync(ICE_REFRESH_MAX_DELAY_MS)
        expect(appelsIce(ctx)).toBe(2)
    })

    // ── Le minuteur meurt avec son Peer ──────────────────────────────────────────

    it('n\'écrit rien quand le Peer visé a été supplanté pendant la récupération', async () => {
        // Même famille que la garde d'annulation de `_doInit` : l'`await` ouvre une fenêtre pendant
        // laquelle le singleton peut changer. Écrire au retour viserait une instance périmée, et
        // réarmer doublerait le minuteur de celle qui l'a remplacée.
        //
        // ⚠️ La supplantation est simulée par l'écriture directe de `peerStore.localPeer` — parce
        // que c'est LITTÉRALEMENT ce que fait une init concurrente (`_doInit` assigne le store en
        // direct). Passer par le vrai chemin de destruction serait pire qu'inutile ici : il demande
        // d'écouler `PEER_DESTROY_DELAY_MS` (10 s), ce qui dépasse `ICE_FETCH_TIMEOUT_MS` (3 s), donc
        // la récupération sortirait en repli AVANT la supplantation et le test verdirait sur la
        // garde « pas de TTL ⇒ pas d'écriture » sans jamais exercer celle-ci. Mesuré : c'est ce que
        // faisait la première version de ce test.
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('stream-a')
        ctx.AjaxService.load.mockResolvedValue({ iceServers: ICE, credential_ttl: TTL_SECONDES })

        const [api] = mount(usePeerTransport, ctx)
        const peer = await bootLocalPeer(
            () => api.setLocalPeer(),
            { peerId: 'peer-alice', getPeer: lastPeer, waitForInstance: waitForPeerInstance },
        )

        // La récupération du rafraîchissement est tenue en vol.
        let releaseIce
        ctx.AjaxService.load.mockReturnValue(
            new Promise((resolve) => { releaseIce = () => resolve({ iceServers: ICE_FRAIS, credential_ttl: TTL_SECONDES }) }),
        )
        await vi.advanceTimersByTimeAsync(ECHEANCE_MS)
        expect(appelsIce(ctx)).toBe(2)

        // Un autre Peer prend la place dans le store, requête toujours en vol.
        ctx.peerStore.localPeer = { est: 'un autre Peer' }

        releaseIce()
        await vi.advanceTimersByTimeAsync(0)

        expect(peer.options.config.iceServers).toEqual(ICE)
        // Et surtout : aucun réarmement. Le Peer courant arme le sien.
        expect(ctx.peerStore.peerIceRefreshTimer).toBeNull()
    })

    it('cesse d\'interroger la route dès que le Peer singleton est détruit', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('stream-a')
        ctx.AjaxService.load.mockResolvedValue({ iceServers: ICE, credential_ttl: TTL_SECONDES })

        const [api, app] = mount(usePeerTransport, ctx)
        await bootLocalPeer(
            () => api.setLocalPeer(),
            { peerId: 'peer-alice', getPeer: lastPeer, waitForInstance: waitForPeerInstance },
        )

        app.unmount()
        await vi.advanceTimersByTimeAsync(PEER_DESTROY_DELAY_MS)

        // `resetPeerState` a annulé le minuteur. Sans cette annulation, une requête partirait à
        // chaque échéance, des heures durant, sur un onglet qui n'a plus aucun contexte WebRTC.
        expect(ctx.peerStore.peerIceRefreshTimer).toBeNull()

        await vi.advanceTimersByTimeAsync(ICE_REFRESH_MAX_DELAY_MS)
        expect(appelsIce(ctx)).toBe(1)
    })
})
