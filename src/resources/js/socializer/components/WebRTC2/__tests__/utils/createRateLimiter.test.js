/**
 * createRateLimiter.test.js
 *
 * Tests unitaires de la fenêtre glissante partagée par les deux chemins de rate
 * limiting du package : le hub star (`usePeerTransport.forwardStarMessage`, clé =
 * peerId entrant réel) et les demandes `/ask-to-peer-id` (`usePeerCore`, clé =
 * slug|room|connectionType). Couvre les deux points restés non testés du plan hub :
 * plafond par fenêtre, et purge throttlée des clés inactives (pas de fuite mémoire
 * sur rotation de room).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRateLimiter } from '~socializer/components/WebRTC2/Composables/utils/createRateLimiter.js'

describe('createRateLimiter', () => {
    const WINDOW_MS = 1000
    const MAX = 3

    let limiter

    beforeEach(() => {
        vi.useFakeTimers()
        limiter = createRateLimiter({ windowMs: WINDOW_MS, max: MAX })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('laisse passer `max` appels puis bloque le suivant', () => {
        for (let i = 0; i < MAX; i++) {
            expect(limiter.isLimited('alice')).toBe(false)
        }
        expect(limiter.isLimited('alice')).toBe(true)
    })

    it('les clés sont indépendantes : une clé saturée n\'affecte pas les autres', () => {
        for (let i = 0; i < MAX; i++) limiter.isLimited('alice')
        expect(limiter.isLimited('alice')).toBe(true)

        expect(limiter.isLimited('bob')).toBe(false)
    })

    it('débloque une fois la fenêtre entièrement écoulée', () => {
        for (let i = 0; i < MAX; i++) limiter.isLimited('alice')
        expect(limiter.isLimited('alice')).toBe(true)

        vi.advanceTimersByTime(WINDOW_MS + 1)

        expect(limiter.isLimited('alice')).toBe(false)
    })

    it('glisse (pas de fenêtre fixe) : les jetons se libèrent un par un', () => {
        // 2 jetons à t=0, le 3ᵉ à t=600 → à t=1001 seuls les deux premiers ont expiré.
        limiter.isLimited('alice')
        limiter.isLimited('alice')
        vi.advanceTimersByTime(600)
        limiter.isLimited('alice')
        expect(limiter.isLimited('alice')).toBe(true)

        // t = 1001 : les deux jetons de t=0 sont sortis, celui de t=600 est encore là.
        vi.advanceTimersByTime(401)
        expect(limiter.isLimited('alice')).toBe(false)  // 2ᵉ jeton repris
        expect(limiter.isLimited('alice')).toBe(false)  // 3ᵉ jeton repris
        expect(limiter.isLimited('alice')).toBe(true)   // plafond de nouveau atteint

        // Une fenêtre fixe aurait tout libéré d'un coup à t=1000 et laissé passer 3.
    })

    it('un appel bloqué ne consomme pas de jeton (pas de bannissement définitif)', () => {
        for (let i = 0; i < MAX; i++) limiter.isLimited('alice')

        // Boucle serrée pendant presque toute la fenêtre : chaque appel est rejeté
        // sans repousser la date de sortie des jetons déjà posés.
        for (let t = 0; t < 900; t += 50) {
            vi.advanceTimersByTime(50)
            expect(limiter.isLimited('alice')).toBe(true)
        }

        // La fenêtre finit malgré tout par s'écouler depuis les jetons initiaux.
        vi.advanceTimersByTime(200)
        expect(limiter.isLimited('alice')).toBe(false)
    })

    it('purge les clés devenues inactives (anti-fuite mémoire)', () => {
        limiter.isLimited('alice')
        limiter.isLimited('bob')
        expect(limiter.size()).toBe(2)

        // Au-delà d'une fenêtre, plus aucun timestamp d'alice/bob n'est valide.
        // Le prochain appel (sur une autre clé) déclenche le balayage global.
        vi.advanceTimersByTime(WINDOW_MS + 1)
        limiter.isLimited('carol')

        expect(limiter.size()).toBe(1)
    })

    it('throttle le balayage à au plus une fois par fenêtre', () => {
        // Le balayage est *throttlé*, pas synchrone avec l'expiration : une clé peut
        // rester en mémoire un moment après être devenue inactive. C'est le compromis
        // assumé (coût O(n) borné à un passage par fenêtre) ; ce test le verrouille.
        // Il faut une clé RAFRAÎCHIE entre deux balayages pour l'observer — sinon sa
        // date d'expiration coïncide avec l'autorisation du balayage suivant.
        limiter.isLimited('alice')              // t=0    → alice@0
        vi.advanceTimersByTime(WINDOW_MS - 1)
        limiter.isLimited('alice')              // t=999  → alice@[0, 999], pas de balayage

        vi.advanceTimersByTime(1)
        limiter.isLimited('bob')                // t=1000 → balayage : alice (999) survit
        expect(limiter.size()).toBe(2)

        vi.advanceTimersByTime(WINDOW_MS - 1)
        limiter.isLimited('carol')              // t=1999 → 999 ms depuis le balayage → aucun
        // alice est périmée (dernier jeton à 999, fenêtre ouverte à 999) mais toujours
        // en mémoire : c'est exactement ce que le throttle autorise.
        expect(limiter.size()).toBe(3)

        vi.advanceTimersByTime(2)
        limiter.isLimited('dave')               // t=2001 → balayage : alice et bob purgées
        expect(limiter.size()).toBe(2)          // carol (1999) + dave
    })

    it('reset() vide tout l\'état', () => {
        for (let i = 0; i < MAX; i++) limiter.isLimited('alice')
        expect(limiter.isLimited('alice')).toBe(true)
        expect(limiter.size()).toBe(1)

        limiter.reset()

        expect(limiter.size()).toBe(0)
        expect(limiter.isLimited('alice')).toBe(false)
    })

    it('deux instances ne partagent pas leur état', () => {
        const other = createRateLimiter({ windowMs: WINDOW_MS, max: MAX })

        for (let i = 0; i < MAX; i++) limiter.isLimited('alice')
        expect(limiter.isLimited('alice')).toBe(true)

        expect(other.isLimited('alice')).toBe(false)
    })
})
