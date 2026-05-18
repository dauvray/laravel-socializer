/**
 * ⏱️ usePeerRetry
 * Gère uniquement la logique temporelle des tentatives (Backoff exponentiel).
 *
 * @param {object} ctx
 * @param {object} [options]
 * @param {number}   [options.maxAttempts]      - Nombre maximal de tentatives avant abandon (défaut : MAX_RETRY_ATTEMPTS).
 * @param {Function} [options.onAbandoned]      - Appelé quand toutes les tentatives sont épuisées.
 *                                                Signature : (userSlug, attempt, error?) => void
 */
import { onUnmounted } from 'vue'
import { MAX_RETRY_ATTEMPTS } from '../../webrtc2.config.js'

export function usePeerRetry(ctx, options = {}) {
    const {
        maxAttempts = MAX_RETRY_ATTEMPTS,
        onAbandoned = null,
    } = options

    const pendingTimers = new Map()

    // Clé unique pour isoler les retries par type/room/user
    const _retryKey = (userSlug) => 
        `${ctx.currentType.value}:${ctx.currentRoom.value}:${userSlug}`

    /**
     * Annule une tentative en cours pour un utilisateur donné.
     * @param {string} userSlug - Identifiant unique de l'utilisateur.
     * @returns {void}
     */
    const clearRetry = (userSlug) => {
        const key = _retryKey(userSlug)
        if (pendingTimers.has(key)) {
            clearTimeout(pendingTimers.get(key))
            pendingTimers.delete(key)
        }
    }

    /**
     * Stoppe toutes les tentatives en cours (ex: lors de la fermeture d'une room ou du composant)
     * @returns {void}
     */
    const clearAll = () => {
        pendingTimers.forEach(timer => clearTimeout(timer))
        pendingTimers.clear()
    }

    /**
     * @param {string} userSlug 
     * @param {number} attempt - Index de la tentative (0, 1, 2...)
     * @param {Function} executionCallback - Doit retourner true pour ARRÊTER, false pour CONTINUER le retry.
     *                                       Peut lever une erreur avec `error.fatal = true` pour stopper sans retry.
     */
    const scheduleRetry = (userSlug, attempt, executionCallback) => {
        // Validation du callback
        if (typeof executionCallback !== 'function') {
            console.error(`[RetryManager] executionCallback must be a function (got ${typeof executionCallback}) for ${userSlug}`)
            return
        }

        if (attempt >= maxAttempts) {
            clearRetry(userSlug)
            console.warn(`[RetryManager] Abandoned after ${maxAttempts} attempts for ${userSlug}`)
            if (typeof onAbandoned === 'function') {
                onAbandoned(userSlug, attempt)
            }
            return
        }

        const key = _retryKey(userSlug)
        clearRetry(userSlug) // On nettoie l'éventuel timer précédent

        // Calcul du délai : exponentiel (1s, 2s, 4s, 8s...) + petit jitter aléatoire
        const delay = Math.min(1000 * (2 ** attempt), 10000) + Math.floor(Math.random() * 300)

        const timer = setTimeout(async () => {
            pendingTimers.delete(key)
            
            try {
                // On exécute la logique métier fournie par l'orchestrateur
                const isFinished = await executionCallback(userSlug, attempt)
                
                // Si le callback renvoie false, on replanifie la tentative suivante
                if (!isFinished) {
                    scheduleRetry(userSlug, attempt + 1, executionCallback)
                }
            } catch(e) {
                console.error(`[RetryManager] Error during attempt ${attempt} for ${userSlug}:`, e)

                // Erreur fatale : on arrête et on notifie sans replanifier
                if (e?.fatal) {
                    clearRetry(userSlug)
                    console.warn(`[RetryManager] Fatal error — aborting retries for ${userSlug}`)
                    if (typeof onAbandoned === 'function') {
                        onAbandoned(userSlug, attempt, e)
                    }
                    return
                }

                // Erreur non-fatale : on replanifie la tentative suivante
                scheduleRetry(userSlug, attempt + 1, executionCallback)
            }
        }, delay)

        pendingTimers.set(key, timer)
    }

    // Sécurité : si le composant Vue est détruit, on stoppe tout
    onUnmounted(() => clearAll())

    return { 
        scheduleRetry, 
        clearRetry, 
        clearAll 
    }
}