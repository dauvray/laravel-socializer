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

    /*
    |--------------------------------------------------------------------------
    | Mode pondéré — le même limiteur compte des octets (budget agrégé du hub)
    |--------------------------------------------------------------------------
    |
    | Le hub star a besoin de plafonner `octets × destinataires`, pas un nombre
    | d'appels. C'est le MÊME mécanisme avec un poids : sans poids explicite, la
    | somme des poids est le nombre d'appels, d'où la rétrocompatibilité des
    | tests ci-dessus.
    */

    describe('poids explicite', () => {
        it('un appel de poids N consomme N jetons', () => {
            // MAX = 3 : un seul appel de poids 3 remplit la fenêtre entière.
            expect(limiter.isLimited('alice', MAX)).toBe(false)
            expect(limiter.isLimited('alice', 1)).toBe(true)
        })

        it('additionne les poids hétérogènes jusqu\'au plafond', () => {
            expect(limiter.isLimited('alice', 1)).toBe(false)  // total 1
            expect(limiter.isLimited('alice', 1)).toBe(false)  // total 2
            expect(limiter.isLimited('alice', 1)).toBe(false)  // total 3 = MAX
            expect(limiter.isLimited('alice', 1)).toBe(true)
        })

        /**
         * LA sémantique du budget, et elle est délibérée : le contrôle porte sur le
         * total DÉJÀ posé, jamais sur « total + poids du nouvel appel ». Un unique
         * message dont le coût dépasse à lui seul le budget passe donc — c'est ce qui
         * autorise un gros fan-out isolé (64 Ko × 100 membres) tout en coupant
         * l'amplification soutenue, qui est le vrai risque.
         */
        it('laisse passer un appel dont le poids dépasse à lui seul le plafond, puis bloque', () => {
            expect(limiter.isLimited('alice', MAX * 1000)).toBe(false)
            expect(limiter.isLimited('alice', 1)).toBe(true)
        })

        it('un appel bloqué ne consomme pas son poids (pas de bannissement définitif)', () => {
            limiter.isLimited('alice', MAX)

            // Boucle serrée de gros appels rejetés : aucun ne doit repousser la date de
            // sortie du jeton initial, sinon le plafond deviendrait permanent.
            for (let t = 0; t < 900; t += 50) {
                vi.advanceTimersByTime(50)
                expect(limiter.isLimited('alice', MAX * 100)).toBe(true)
            }

            vi.advanceTimersByTime(200)
            expect(limiter.isLimited('alice', 1)).toBe(false)
        })

        it('libère le poids par la fenêtre glissante, appel par appel', () => {
            // 2 jetons à t=0 (poids 1 + 1), le 3ᵉ à t=600.
            limiter.isLimited('alice', 1)
            limiter.isLimited('alice', 1)
            vi.advanceTimersByTime(600)
            limiter.isLimited('alice', 1)
            expect(limiter.isLimited('alice', 1)).toBe(true)

            // t=1001 : les deux poids de t=0 sont sortis, celui de t=600 reste.
            vi.advanceTimersByTime(401)
            expect(limiter.isLimited('alice', 2)).toBe(false)
            expect(limiter.isLimited('alice', 1)).toBe(true)
        })

        it('les clés restent indépendantes en mode pondéré', () => {
            expect(limiter.isLimited('alice', MAX)).toBe(false)
            expect(limiter.isLimited('alice', 1)).toBe(true)

            expect(limiter.isLimited('bob', 1)).toBe(false)
        })

        it('un poids nul ne consomme rien et ne bloque jamais', () => {
            // Cas dégénéré volontairement autorisé : un fan-out vide n'a pas de coût.
            for (let i = 0; i < 10; i++) {
                expect(limiter.isLimited('alice', 0)).toBe(false)
            }
            expect(limiter.isLimited('alice', MAX)).toBe(false)
        })

        it('purge les clés pondérées devenues inactives (anti-fuite mémoire)', () => {
            limiter.isLimited('alice', MAX * 10)
            limiter.isLimited('bob', 1)
            expect(limiter.size()).toBe(2)

            vi.advanceTimersByTime(WINDOW_MS + 1)
            limiter.isLimited('carol', 1)

            expect(limiter.size()).toBe(1)
        })
    })
})
