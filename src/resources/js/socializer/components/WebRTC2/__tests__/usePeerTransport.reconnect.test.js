/**
 * usePeerTransport.reconnect.test.js — Garde de reconnexion PeerJS
 *
 * PeerJS émet `disconnected` quand le socket de signalisation tombe (réseau, veille de
 * l'onglet, redémarrage du serveur). Le transport replanifie une reconnexion avec un
 * **backoff exponentiel** plafonné, et **abandonne** après `MAX_RECONNECT_ATTEMPTS` — sans
 * ce plafond, un serveur PeerJS injoignable produirait une boucle de reconnexion infinie.
 *
 * Ni le compteur, ni le backoff, ni l'abandon n'étaient couverts (TESTS_PLAN.md, « Reconnect
 * guard »), alors que l'état qui les porte (`_reconnectAttempts`, `_reconnectTimer`) est
 * précisément celui que la migration vers `peerStore` déplace : ces tests sont le filet de
 * cette refacto.
 *
 * Le compteur vivant au niveau du module ES, chaque test charge une copie neuve du
 * composable (et du mock PeerJS, qui doit venir du même reset — cf.
 * `usePeerTransport.singleton.test.js`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import {
    MAX_RECONNECT_ATTEMPTS,
    RECONNECT_BASE_DELAY_MS,
    RECONNECT_MAX_DELAY_MS,
    PEER_DESTROY_DELAY_MS,
} from '~socializer/components/WebRTC2/webrtc2.config.js'

const PEER_ID = 'peer-alice'

/** Délai attendu pour la n-ième tentative (n commence à 1). */
const expectedDelay = (attempt) => Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
    RECONNECT_MAX_DELAY_MS
)

describe('usePeerTransport — reconnexion PeerJS (backoff, plafond, abandon)', () => {
    let app
    let peer
    let ctx

    beforeEach(async () => {
        vi.spyOn(console, 'info').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})

        // Copie neuve : `_reconnectAttempts` est un compteur de module, il fuirait d'un
        // test à l'autre. Le mock PeerJS est rechargé après le même reset pour que
        // `getLastPeerInstance()` voie l'instance créée par cette copie.
        vi.resetModules()
        const [{ usePeerTransport }, peerMock] = await Promise.all([
            import('~socializer/components/WebRTC2/Composables/usePeerTransport.js'),
            import('peerjs'),
        ])
        peerMock.resetPeerMock()

        ctx = createMockContext({
            contextId: 'stream-live',
            session: { currentType: 'stream', currentRoom: 'live' },
        })

        const [api, mounted] = withSetup(() => usePeerTransport(ctx))
        app = mounted
        await api.setLocalPeer()

        peer = peerMock.getLastPeerInstance()
        peer._triggerEvent('open', PEER_ID)

        vi.useFakeTimers()
    })

    afterEach(() => {
        try { app.unmount() } catch { /* déjà démontée */ }
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    /**
     * Une déconnexion du socket de signalisation, état COMPRIS.
     *
     * ⚠️ Pas `_triggerEvent('disconnected')` : émettre l'événement sans poser l'état laisserait
     * `peer.disconnected === false`, et le vrai `reconnect()` **lève** sur un peer non
     * déconnecté (`bundler.mjs:1826`). Le mock reproduit désormais cette levée, donc une
     * déconnexion feinte serait une déconnexion que PeerJS ne peut pas produire.
     */
    const disconnectSocket = () => peer.disconnect()

    /** Une déconnexion suivie de l'attente complète de son backoff. */
    const disconnectAndWait = (attempt) => {
        disconnectSocket()
        vi.advanceTimersByTime(expectedDelay(attempt))
    }

    it('replanifie la reconnexion après RECONNECT_BASE_DELAY_MS', () => {
        disconnectSocket()

        // Rien d'immédiat : la reconnexion est différée, sinon une coupure réseau
        // déclencherait une rafale synchrone.
        expect(peer.reconnect).not.toHaveBeenCalled()

        vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS - 1)
        expect(peer.reconnect).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        expect(peer.reconnect).toHaveBeenCalledOnce()
        // Workaround PeerJS : `reconnect()` perd l'id précédent, on le restaure avant.
        // ⚠️ `_lastServerId` et lui seul : c'est le champ dont `reconnect()` repart, et le
        // seul assignable — `id` est un accesseur sans setter (cf. le mock, qui le reproduit
        // désormais). Assigner `id` ici lèverait, et emporterait le `reconnect()` avec.
        expect(peer._lastServerId).toBe(PEER_ID)
        expect(peer.reconnect).toHaveBeenCalledOnce()
    })

    it('applique un backoff exponentiel plafonné à RECONNECT_MAX_DELAY_MS', () => {
        // 1s · 2s · 4s · 8s · 16s puis plafond à 30s (et non 32s).
        for (let attempt = 1; attempt <= 6; attempt += 1) {
            disconnectSocket()

            vi.advanceTimersByTime(expectedDelay(attempt) - 1)
            expect(peer.reconnect).toHaveBeenCalledTimes(attempt - 1)

            vi.advanceTimersByTime(1)
            expect(peer.reconnect).toHaveBeenCalledTimes(attempt)
        }

        expect(expectedDelay(6)).toBe(RECONNECT_MAX_DELAY_MS)
    })

    it('abandonne après MAX_RECONNECT_ATTEMPTS sans boucler', () => {
        for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt += 1) {
            disconnectAndWait(attempt)
        }
        expect(peer.reconnect).toHaveBeenCalledTimes(MAX_RECONNECT_ATTEMPTS)

        disconnectSocket()
        vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2)

        // Plus aucune tentative, et aucun timer laissé en vol.
        expect(peer.reconnect).toHaveBeenCalledTimes(MAX_RECONNECT_ATTEMPTS)
        expect(vi.getTimerCount()).toBe(0)
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('abandon')
        )
    })

    it('remet le compteur à zéro dès qu\'une connexion est rétablie (`open`)', () => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            disconnectAndWait(attempt)
        }

        // Reconnexion réussie : le serveur réattribue l'id.
        peer._triggerEvent('open', PEER_ID)

        // La prochaine coupure repart du délai de base, pas de 8 s.
        disconnectSocket()
        vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS)

        expect(peer.reconnect).toHaveBeenCalledTimes(4)
    })

    // ── L'état annoncé pendant la coupure ────────────────────────────────────────
    //
    // Ces deux tests épinglent le correctif le plus coûteux de la série : un peer déconnecté
    // continuait de se déclarer « prêt ». `setLocalPeer()` sortait alors par son premier garde
    // et `waitForMeReady()` répondait oui (il lit `lastLocalPeerId`, un fait HISTORIQUE),
    // pendant que `getLocalPeerId` rendait `null` — `Peer.disconnect()` met `_id` à null.
    // Chaque publication du peerId local sortait en `warn` : l'onglet ne répondait plus à
    // aucune demande de peerId, sans le moindre signe visible.

    it('cesse de se déclarer prêt dès la déconnexion du socket', () => {
        expect(ctx.peerStore.localPeerReady).toBe(true)

        disconnectSocket()

        expect(ctx.peerStore.localPeerReady).toBe(false)
    })

    it('se redéclare prêt quand la reconnexion aboutit RÉELLEMENT', () => {
        disconnectSocket()
        vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS)

        // ⭐ Le contrat que le mock ne mesurait pas. `reconnect()` était un `vi.fn()` vide :
        // toute la suite ne vérifiait que « a-t-il été appelé ». Ici il porte son vrai
        // contrat — il repart de `_lastServerId`, que l'appelant DOIT avoir restauré, et
        // n'ouvre rien de synchrone. C'est le serveur qui répond, ci-dessous.
        expect(peer.reconnect).toHaveBeenCalledOnce()
        expect(peer.disconnected).toBe(false)
        expect(ctx.peerStore.localPeerReady).toBe(false)

        // Le serveur répond à la réouverture du socket, avec l'id restauré.
        peer._triggerEvent('open', peer._lastServerId)

        expect(ctx.peerStore.localPeerReady).toBe(true)
        // L'onglet a bien retrouvé SON identité, pas une neuve. Nuance avec l'assertion du
        // premier test : là c'est `_lastServerId` avant l'appel (ce que l'appelant restaure),
        // ici c'est l'id après le tour complet — donc l'effet, et lui seul, qui aurait été
        // rouge tant que la ligne fautive sautait le `reconnect()`.
        expect(peer.id).toBe(PEER_ID)
        expect(ctx.peerStore.lastLocalPeerId).toBe(PEER_ID)
    })

    it('nomme la contradiction quand la reconnexion est abandonnée', () => {
        for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt += 1) {
            disconnectAndWait(attempt)
        }
        console.error.mockClear()

        // La déconnexion de trop : plus aucun backoff ne sera armé.
        disconnectSocket()

        // ⭐ L'état terminal, enfin nommé. `lastLocalPeerId` reste posé sur un peer que rien
        // ne va reconnecter, et `waitForMeReady` — qui ne lit que ce champ — continuera de
        // répondre « prêt ». C'est exactement l'état dans lequel un onglet ne répond plus à
        // aucune demande de peerId sans qu'aucune ligne ne le dise ; celui qu'il a fallu
        // deviner à la main en croisant les logs Docker et nginx.
        expect(ctx.peerStore.auditPeerState).toHaveBeenCalledWith(
            expect.stringContaining('abandon')
        )
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('[WebRTC2][invariant]'),
            expect.objectContaining({
                violations: expect.arrayContaining([
                    expect.objectContaining({ code: 'id-historique-sur-peer-inutilisable' }),
                ]),
            })
        )
    })

    // ── Deux préconditions de `reconnect()` que rien ne tenait ───────────────────
    //
    // Le mock rendait `reconnect()` par un `vi.fn()` vide : toute la suite mesurait « a-t-il
    // été appelé », jamais s'il était appelable. Le vrai client LÈVE dans deux cas, et
    // l'appel vit dans un `setTimeout` — une Error y serait `unhandled`, donc muette.

    it('n\'arme jamais deux backoffs à la fois', () => {
        disconnectSocket()

        // Une seconde coupure avant l'échéance de la première. PeerJS n'émet pas deux
        // `disconnected` d'affilée aujourd'hui (son `disconnect()` sort tôt), mais rien ici
        // ne s'appuyait sur cette garantie : l'assignation du handle ÉCRASAIT le précédent
        // sans l'annuler, laissant un timer orphelin — plus aucune référence pour le
        // `clearReconnectTimer`, et un `reconnect()` en trop à son échéance.
        peer._triggerEvent('disconnected')

        expect(vi.getTimerCount()).toBe(1)
    })

    it('ne tente pas de reconnecter un Peer qui s\'est reconnecté entre-temps', () => {
        disconnectSocket()

        // Le serveur répond de lui-même avant l'échéance du backoff : le peer n'est plus
        // déconnecté. `reconnect()` y lèverait (« cannot reconnect because it is not
        // disconnected from the server », `bundler.mjs:1827`).
        peer._triggerEvent('open', PEER_ID)

        expect(() => vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS)).not.toThrow()
        expect(peer.reconnect).not.toHaveBeenCalled()
    })

    it('ne tente rien sur un Peer détruit', () => {
        peer._markDestroyed()

        disconnectSocket()
        vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS)

        expect(peer.reconnect).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    // ── Destruction volontaire ≠ coupure réseau ──────────────────────────────────
    //
    // `peer.destroy()` (peerjs 1.5.4, `dist/bundler.mjs:1776-1783`) appelle `disconnect()`,
    // qui **émet `disconnected`** (l.1810), et ne pose `_destroyed` qu'ENSUITE (l.1781).
    // Pendant une destruction volontaire, le garde du handler
    // (`!peerStore.localPeer || peerStore.localPeer.destroyed`) ne voit donc rien : le store
    // porte encore le peer (son reset vient après) et le drapeau est encore faux. Sans
    // détachement explicite des listeners, chaque teardown est traité comme une coupure
    // réseau — et `_cleanup()` ne retire que les listeners du socket interne (l.1789), jamais
    // les nôtres.

    it('la destruction volontaire du Peer n\'est pas traitée comme une coupure réseau', () => {
        // Dernier consommateur parti : destruction planifiée, aucun incident réseau.
        app.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)

        expect(peer.destroy).toHaveBeenCalledOnce()

        // Un teardown ne consomme pas de tentative de reconnexion et n'annonce pas une
        // reconnexion qui n'aura jamais lieu : ce `warn` est le seul récit que le module
        // laisse d'une coupure, il ne doit pas décrire un événement qui n'a pas eu lieu.
        expect(ctx.peerStore.incrementReconnectAttempts).not.toHaveBeenCalled()
        expect(console.warn).not.toHaveBeenCalledWith(
            expect.stringContaining('déconnecté')
        )

        vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2)

        expect(peer.reconnect).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('un teardown alors que le compteur est au plafond ne crie pas « abandon »', () => {
        for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt += 1) {
            disconnectAndWait(attempt)
        }
        // Compteur au plafond, mais l'abandon n'a pas encore été annoncé : il l'est à la
        // déconnexion SUIVANTE (cf. « abandonne après MAX_RECONNECT_ATTEMPTS »). C'est
        // exactement la place que va prendre le faux `disconnected` du teardown.
        expect(ctx.peerStore.peerReconnectAttempts).toBe(MAX_RECONNECT_ATTEMPTS)
        console.error.mockClear()

        app.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)

        // `console.error` est le seul canal d'alerte du module : une fausse alarme
        // « serveur injoignable » sur une destruction volontaire y est un fait observable.
        expect(console.error).not.toHaveBeenCalled()
    })

    it('un backoff armé pendant le délai de grâce ne survit pas à la destruction', () => {
        // Dernier consommateur parti : destruction planifiée dans PEER_DESTROY_DELAY_MS.
        app.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS - 500)

        // Le socket tombe juste avant l'échéance : un backoff est armé (+1 s), donc au-delà.
        disconnectSocket()
        vi.advanceTimersByTime(500)

        expect(peer.destroy).toHaveBeenCalledOnce()
        // Le timer de reconnexion a été annulé avec le peer — sinon il fuit jusqu'à son
        // échéance, sur un store déjà réinitialisé.
        expect(vi.getTimerCount()).toBe(0)

        vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS)
        expect(peer.reconnect).not.toHaveBeenCalled()
    })
})
