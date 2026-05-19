/**
 * usePeerRetry.test.js
 *
 * Tests unitaires du moteur de retry avec backoff exponentiel.
 * Utilise vi.useFakeTimers() pour contrôler le temps sans attendre réellement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from '../helpers/createMockContext.js'
import { withSetup } from '../helpers/withSetup.js'
import { usePeerRetry } from '~socializer/components/WebRTC2/Composables/utils/usePeerRetry.js'

describe('usePeerRetry', () => {
    let ctx
    let app
    let retry

    beforeEach(() => {
        vi.useFakeTimers()
        ctx = createMockContext()
        ;[retry, app] = withSetup(() => usePeerRetry(ctx))
    })

    afterEach(() => {
        app.unmount()
        vi.useRealTimers()
    })

    // ── scheduleRetry : comportement de base ────────────────────────────────

    describe('scheduleRetry', () => {
        it('appelle le callback après le premier délai', async () => {
            const callback = vi.fn().mockResolvedValue(true) // true = succès, stop
            retry.scheduleRetry('alice', 0, callback)

            expect(callback).not.toHaveBeenCalled()

            // On avance suffisamment pour déclencher attempt 0 (délai ≤ 1300ms)
            await vi.advanceTimersByTimeAsync(2000)

            expect(callback).toHaveBeenCalledOnce()
            expect(callback).toHaveBeenCalledWith('alice', 0)
        })

        it('ne replanifie PAS si le callback retourne true (succès)', async () => {
            const callback = vi.fn().mockResolvedValue(true)
            retry.scheduleRetry('alice', 0, callback)

            await vi.advanceTimersByTimeAsync(15_000)

            // Une seule exécution : le callback a dit "stop"
            expect(callback).toHaveBeenCalledOnce()
        })

        it('replanifie si le callback retourne false (échec temporaire)', async () => {
            let callCount = 0
            const callback = vi.fn(async () => {
                callCount++
                return callCount >= 2 // stop après 2 appels
            })

            retry.scheduleRetry('alice', 0, callback)

            // Avancer assez pour les 2 premiers délais (attempt 0 ≤ 1300ms, attempt 1 ≤ 2300ms)
            await vi.advanceTimersByTimeAsync(10_000)

            expect(callback).toHaveBeenCalledTimes(2)
        })

        it('abandonne après maxAttempts et appelle onAbandoned', async () => {
            const onAbandoned = vi.fn()
            const [localRetry, localApp] = withSetup(() =>
                usePeerRetry(ctx, { maxAttempts: 2, onAbandoned })
            )

            const callback = vi.fn().mockResolvedValue(false) // toujours en échec

            localRetry.scheduleRetry('alice', 0, callback)

            // Avancer largement pour épuiser les 2 tentatives
            await vi.advanceTimersByTimeAsync(60_000)

            expect(onAbandoned).toHaveBeenCalledWith('alice', 2)

            localApp.unmount()
        })

        it('passe le numéro d\'attempt croissant au callback', async () => {
            const attempts = []
            const callback = vi.fn(async (_slug, attempt) => {
                attempts.push(attempt)
                return attempts.length >= 3
            })

            retry.scheduleRetry('alice', 0, callback)
            await vi.advanceTimersByTimeAsync(60_000)

            expect(attempts).toEqual([0, 1, 2])
        })

        it('ne planifie pas si le callback n\'est pas une fonction', () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => {})
            retry.scheduleRetry('alice', 0, 'not-a-function')
            expect(error).toHaveBeenCalled()
            error.mockRestore()
        })
    })

    // ── clearRetry ──────────────────────────────────────────────────────────

    describe('clearRetry', () => {
        it('annule le timer en attente et ne déclenche pas le callback', async () => {
            const callback = vi.fn().mockResolvedValue(true)
            retry.scheduleRetry('alice', 0, callback)

            retry.clearRetry('alice')

            await vi.advanceTimersByTimeAsync(5_000)
            expect(callback).not.toHaveBeenCalled()
        })

        it('est idempotent : clearRetry sur un slug inexistant ne lève pas d\'erreur', () => {
            expect(() => retry.clearRetry('inexistant')).not.toThrow()
        })

        it('annule uniquement l\'utilisateur ciblé', async () => {
            const cbAlice = vi.fn().mockResolvedValue(true)
            const cbBob = vi.fn().mockResolvedValue(true)

            retry.scheduleRetry('alice', 0, cbAlice)
            retry.scheduleRetry('bob', 0, cbBob)

            retry.clearRetry('alice')

            await vi.advanceTimersByTimeAsync(5_000)
            expect(cbAlice).not.toHaveBeenCalled()
            expect(cbBob).toHaveBeenCalledOnce()
        })
    })

    // ── clearAll ────────────────────────────────────────────────────────────

    describe('clearAll', () => {
        it('annule tous les timers en attente', async () => {
            const cbAlice = vi.fn().mockResolvedValue(true)
            const cbBob = vi.fn().mockResolvedValue(true)
            const cbCarol = vi.fn().mockResolvedValue(true)

            retry.scheduleRetry('alice', 0, cbAlice)
            retry.scheduleRetry('bob', 0, cbBob)
            retry.scheduleRetry('carol', 0, cbCarol)

            retry.clearAll()

            await vi.advanceTimersByTimeAsync(10_000)
            expect(cbAlice).not.toHaveBeenCalled()
            expect(cbBob).not.toHaveBeenCalled()
            expect(cbCarol).not.toHaveBeenCalled()
        })

        it('est idempotent : double clearAll ne lève pas d\'erreur', () => {
            retry.scheduleRetry('alice', 0, vi.fn().mockResolvedValue(true))
            expect(() => {
                retry.clearAll()
                retry.clearAll()
            }).not.toThrow()
        })
    })

    // ── Isolation par clé (type:room:slug) ──────────────────────────────────

    describe('isolation de clé retry', () => {
        it('un nouveau scheduleRetry remplace l\'ancien timer pour le même slug', async () => {
            const cb1 = vi.fn().mockResolvedValue(true)
            const cb2 = vi.fn().mockResolvedValue(true)

            retry.scheduleRetry('alice', 0, cb1)
            retry.scheduleRetry('alice', 0, cb2) // remplace cb1

            await vi.advanceTimersByTimeAsync(5_000)

            // Seul cb2 doit avoir été appelé (cb1 a été annulé)
            expect(cb1).not.toHaveBeenCalled()
            expect(cb2).toHaveBeenCalledOnce()
        })
    })

    // ── Erreur fatale ───────────────────────────────────────────────────────

    describe('gestion des erreurs', () => {
        it('une erreur non-fatale replanifie la tentative suivante', async () => {
            let callCount = 0
            const callback = vi.fn(async () => {
                callCount++
                if (callCount === 1) throw new Error('erreur temporaire')
                return true // succès au 2e appel
            })

            retry.scheduleRetry('alice', 0, callback)
            await vi.advanceTimersByTimeAsync(15_000)

            expect(callback).toHaveBeenCalledTimes(2)
        })

        it('une erreur fatale stoppe les retries sans replanifier', async () => {
            const onAbandoned = vi.fn()
            const [localRetry, localApp] = withSetup(() =>
                usePeerRetry(ctx, { onAbandoned })
            )

            const callback = vi.fn(async () => {
                const err = new Error('fatal')
                err.fatal = true
                throw err
            })

            localRetry.scheduleRetry('alice', 0, callback)
            await vi.advanceTimersByTimeAsync(10_000)

            // Une seule exécution, puis stop
            expect(callback).toHaveBeenCalledOnce()
            expect(onAbandoned).toHaveBeenCalled()

            localApp.unmount()
        })
    })

    // ── Cleanup lifecycle ───────────────────────────────────────────────────

    describe('cleanup onUnmounted', () => {
        it('stoppe tous les timers quand le composant est détruit', async () => {
            const callback = vi.fn().mockResolvedValue(false) // toujours en retry
            retry.scheduleRetry('alice', 0, callback)

            // Détruire le composant Vue
            app.unmount()

            await vi.advanceTimersByTimeAsync(30_000)

            // Aucun callback ne doit avoir été appelé (le timer a été nettoyé)
            expect(callback).not.toHaveBeenCalled()

            // Re-créer pour afterEach
            ;[retry, app] = withSetup(() => usePeerRetry(ctx))
        })
    })
})
