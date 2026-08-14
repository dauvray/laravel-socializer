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

    /** Une déconnexion suivie de l'attente complète de son backoff. */
    const disconnectAndWait = (attempt) => {
        peer._triggerEvent('disconnected')
        vi.advanceTimersByTime(expectedDelay(attempt))
    }

    it('replanifie la reconnexion après RECONNECT_BASE_DELAY_MS', () => {
        peer._triggerEvent('disconnected')

        // Rien d'immédiat : la reconnexion est différée, sinon une coupure réseau
        // déclencherait une rafale synchrone.
        expect(peer.reconnect).not.toHaveBeenCalled()

        vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS - 1)
        expect(peer.reconnect).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        expect(peer.reconnect).toHaveBeenCalledOnce()
        // Workaround PeerJS : `reconnect()` perd l'id précédent, on le restaure avant.
        expect(peer.id).toBe(PEER_ID)
        expect(peer._lastServerId).toBe(PEER_ID)
    })

    it('applique un backoff exponentiel plafonné à RECONNECT_MAX_DELAY_MS', () => {
        // 1s · 2s · 4s · 8s · 16s puis plafond à 30s (et non 32s).
        for (let attempt = 1; attempt <= 6; attempt += 1) {
            peer._triggerEvent('disconnected')

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

        peer._triggerEvent('disconnected')
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
        peer._triggerEvent('disconnected')
        vi.advanceTimersByTime(RECONNECT_BASE_DELAY_MS)

        expect(peer.reconnect).toHaveBeenCalledTimes(4)
    })

    it('ne tente rien sur un Peer détruit', () => {
        peer.destroyed = true

        peer._triggerEvent('disconnected')
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
        peer._triggerEvent('disconnected')
        vi.advanceTimersByTime(500)

        expect(peer.destroy).toHaveBeenCalledOnce()
        // Le timer de reconnexion a été annulé avec le peer — sinon il fuit jusqu'à son
        // échéance, sur un store déjà réinitialisé.
        expect(vi.getTimerCount()).toBe(0)

        vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS)
        expect(peer.reconnect).not.toHaveBeenCalled()
    })
})
