/**
 * useSignalingQueue.test.js — Couche signalisation
 *
 * Périmètre : routage des signaux serveur entrants vers les handlers injectés.
 * La couche ne connaît que des handlers opaques (table `routes` construite par
 * l'orchestrateur), ce qui la rend testable sans PeerJS, sans Ajax et sans les
 * sous-modules qu'elle sert.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { useSignalingQueue } from '~socializer/components/WebRTC2/Composables/useSignalingQueue.js'

describe('useSignalingQueue', () => {
    let ctx
    let app
    let signaling
    let routes
    let warnSpy
    let errorSpy
    let debugSpy

    // Le routage est asynchrone (await waitForMeReady puis await handler) : il faut
    // laisser passer le flush du watcher PUIS les microtâches de la chaîne de promesses.
    const flushSignals = async () => {
        await nextTick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
    }

    const pushSignal = async (signal) => {
        ctx.peerStore._pushSignal(signal)
        await flushSignals()
    }

    const mountSignaling = (context = ctx) => {
        ;[signaling, app] = withSetup(() => useSignalingQueue(context, { routes }))
    }

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
        routes = {
            PEER_CONNECTION_REQUEST: vi.fn().mockResolvedValue(undefined),
            PEER_CONNECT_TO_REMOTE_PEER: vi.fn().mockReturnValue(true),
        }
        ctx = createMockContext()
        mountSignaling()
    })

    afterEach(() => {
        app.unmount()
        warnSpy.mockRestore()
        errorSpy.mockRestore()
        debugSpy.mockRestore()
    })

    // ── routage ─────────────────────────────────────────────────────────────

    describe('routage', () => {

        it('route chaque type déclaré vers son handler', async () => {
            await pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: { fromUserSlug: 'alice' } })

            expect(routes.PEER_CONNECTION_REQUEST).toHaveBeenCalledTimes(1)
            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).not.toHaveBeenCalled()

            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: { userSlug: 'bob' } })

            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).toHaveBeenCalledTimes(1)
            expect(routes.PEER_CONNECTION_REQUEST).toHaveBeenCalledTimes(1)
        })

        it('passe uniquement signal.payload au handler, jamais l\'enveloppe', async () => {
            const payload = { fromUserSlug: 'alice', room: 'app', type: 'data' }
            await pushSignal({ roomId: 'test-data-app', type: 'PEER_CONNECTION_REQUEST', payload, ts: 1 })

            expect(routes.PEER_CONNECTION_REQUEST).toHaveBeenCalledWith(payload)
        })

        it('loggue un warn et n\'appelle aucun handler pour un type inconnu', async () => {
            await pushSignal({ type: 'SIGNAL_INEXISTANT', payload: {} })

            expect(routes.PEER_CONNECTION_REQUEST).not.toHaveBeenCalled()
            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).not.toHaveBeenCalled()
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('aucun handler pour le signal "SIGNAL_INEXISTANT"')
            )
        })

        it('ignore un signal sans type de premier niveau (enveloppe payload.type des widgets)', async () => {
            await pushSignal({ payload: { type: 'AUDIO_MUTE_TOGGLE', isMuted: true } })

            expect(routes.PEER_CONNECTION_REQUEST).not.toHaveBeenCalled()
            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).not.toHaveBeenCalled()
            // Enveloppe légitime d'un autre espace de noms : pas un warn
            expect(warnSpy).not.toHaveBeenCalled()
        })

        it('loggue un warn pour un signal sans aucun type (ni racine ni payload)', async () => {
            await pushSignal({ payload: { isMuted: true } })

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('signal sans type'),
                expect.anything()
            )
        })
    })

    // ── absence de précondition (régression : signal abandonné) ─────────────

    describe('absence de précondition asynchrone', () => {

        it('route le signal sans attendre l\'identité locale', async () => {
            // ⚠️ Régression corrigée : une version attendait ctx.waitForMeReady() avant
            // d'appeler le handler, et abandonnait le signal après 15 s. Comme
            // PEER_CONNECT_TO_REMOTE_PEER n'est jamais re-livré, un arrivant ne voyait
            // pas le flux existant, de façon intermittente.
            app.unmount()
            ctx = createMockContext({
                // Ne résout JAMAIS : si le routage l'attendait, le handler ne serait jamais appelé
                waitForMeReady: vi.fn(() => new Promise(() => {})),
            })
            mountSignaling()

            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: { userSlug: 'bob' } })

            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).toHaveBeenCalledTimes(1)
            expect(ctx.waitForMeReady).not.toHaveBeenCalled()
        })

        it('route le signal même pendant un arrêt en cours (le garde appartient aux handlers)', async () => {
            ctx.beginShutdown()

            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: { userSlug: 'bob' } })

            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).toHaveBeenCalledTimes(1)
        })
    })

    // ── erreurs ─────────────────────────────────────────────────────────────

    describe('erreurs', () => {

        it('loggue l\'échec d\'un handler sans casser l\'observation', async () => {
            routes.PEER_CONNECTION_REQUEST.mockRejectedValueOnce(new Error('POST failed'))

            await pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: { fromUserSlug: 'alice' } })

            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining('handler "PEER_CONNECTION_REQUEST" a échoué:'),
                expect.any(Error)
            )

            // Le watcher survit : le signal suivant est toujours routé
            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: { userSlug: 'bob' } })

            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).toHaveBeenCalledTimes(1)
        })
    })

    // ── cleanup ─────────────────────────────────────────────────────────────

    describe('cleanup', () => {

        it('stopSignaling() coupe l\'observation', async () => {
            signaling.stopSignaling()

            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: { userSlug: 'bob' } })

            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).not.toHaveBeenCalled()
        })

        it('stopSignaling() est idempotent', async () => {
            signaling.stopSignaling()
            signaling.stopSignaling()

            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: { userSlug: 'bob' } })

            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).not.toHaveBeenCalled()
        })

        it('le démontage coupe l\'observation (filet de sécurité)', async () => {
            app.unmount()

            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: { userSlug: 'bob' } })

            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).not.toHaveBeenCalled()
        })

        it('ne route plus rien après stopSignaling(), même sur un autre type de signal', async () => {
            signaling.stopSignaling()

            await pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: { fromUserSlug: 'alice' } })

            expect(routes.PEER_CONNECTION_REQUEST).not.toHaveBeenCalled()
        })
    })

    // ── détection de coalescence ────────────────────────────────────────────

    describe('détection de coalescence', () => {

        // La consommation est « dernier signal de la room » (at(-1)) : deux signaux
        // dispatchés dans le même tick n'en déclenchent qu'un. Aucun chemin de prod ne
        // produit ça aujourd'hui — le `seq` monotone posé par dispatchSignal est la seule
        // preuve possible que ça arrive un jour. Ces tests valident le détecteur, pas un
        // drain (cf. TODOLIST « Drainer réellement la file de signaux »).

        const missedWarn = (count) =>
            expect.stringContaining(`${count} signal(s) non routé(s)`)

        it('warne sur un trou de seq et route quand même le signal reçu', async () => {
            await pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: {}, seq: 1 })
            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: { userSlug: 'bob' }, seq: 3 })

            expect(warnSpy).toHaveBeenCalledWith(missedWarn(1))
            // Le détecteur observe, il n'interrompt pas le routage
            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).toHaveBeenCalledTimes(1)
        })

        it('détecte la coalescence réelle : deux signaux poussés dans le même tick', async () => {
            ctx.peerStore._pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: {}, seq: 1 })
            await flushSignals()

            // Même tick : le watcher ne verra que le dernier
            ctx.peerStore._pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: {}, seq: 2 })
            ctx.peerStore._pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: { userSlug: 'bob' }, seq: 3 })
            await flushSignals()

            expect(routes.PEER_CONNECTION_REQUEST).toHaveBeenCalledTimes(1)
            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).toHaveBeenCalledTimes(1)
            expect(warnSpy).toHaveBeenCalledWith(missedWarn(1))
        })

        it('ne warne pas sur des seq consécutifs', async () => {
            await pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: {}, seq: 1 })
            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: {}, seq: 2 })
            await pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: {}, seq: 3 })

            expect(warnSpy).not.toHaveBeenCalled()
        })

        it('ne warne pas sur le premier signal, quel que soit son seq', async () => {
            // Le compteur du store survit aux remontages du composable (HMR, provider
            // remonté) : le premier seq observé initialise, il ne prouve aucune perte.
            await pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: {}, seq: 42 })

            expect(warnSpy).not.toHaveBeenCalled()
            expect(routes.PEER_CONNECTION_REQUEST).toHaveBeenCalledTimes(1)
        })

        it('ne warne pas quand les enveloppes n\'ont pas de seq', async () => {
            await pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: {} })
            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: {} })

            expect(warnSpy).not.toHaveBeenCalled()
        })

        it('avance le compteur sur un signal non routable (pas de trou permanent)', async () => {
            await pushSignal({ type: 'SIGNAL_INEXISTANT', payload: {}, seq: 1 })
            warnSpy.mockClear() // on ne garde que le warn « aucun handler »

            await pushSignal({ type: 'PEER_CONNECT_TO_REMOTE_PEER', payload: {}, seq: 2 })

            expect(routes.PEER_CONNECT_TO_REMOTE_PEER).toHaveBeenCalledTimes(1)
            expect(warnSpy).not.toHaveBeenCalled()
        })

        it('ne warne pas quand la file est vidée en pleine session', async () => {
            // clearSignalQueueRoom (stopWebcamStream, stopCallWithPeers) fait repasser
            // lastRoomSignal à null alors que le watcher tourne encore.
            await pushSignal({ type: 'PEER_CONNECTION_REQUEST', payload: {}, seq: 1 })

            ctx.peerStore._clearSignals()
            await flushSignals()

            expect(warnSpy).not.toHaveBeenCalled()
        })
    })
})
