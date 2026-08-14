/**
 * createRateLimiter.js — Fenêtre glissante par clé (rate limiting WebRTC2)
 *
 * Source de vérité unique de la mécanique de plafonnement du package. Deux chemins
 * la consomment, avec des clés et des dimensionnements différents :
 *   - `usePeerTransport` (hub star)  → clé = peerId PeerJS entrant réel
 *   - `usePeerCore` (`/ask-to-peer-id`) → clé = `slug|room|connectionType`
 *
 * Une instance porte son propre état ; c'est l'appelant qui décide de sa portée
 * (module-level pour survivre à un mount/unmount, ou locale pour être isolée).
 */

/**
 * Crée un limiteur à fenêtre glissante.
 *
 * @param {Object} options
 * @param {number} options.windowMs  Largeur de la fenêtre glissante (ms)
 * @param {number} options.max       Nombre d'appels autorisés dans la fenêtre
 * @returns {{ isLimited: (key: string) => boolean, reset: () => void, size: () => number }}
 */
export function createRateLimiter({ windowMs, max }) {

    // Fenêtre glissante par clé : chaque entrée est un tableau de timestamps.
    const windows = new Map()

    // Horodatage du dernier balayage global, pour throttler la purge des entrées
    // devenues inactives à au plus une fois par fenêtre glissante.
    let lastSweep = 0

    /**
     * Purge les clés dont tous les timestamps ont expiré : leurs entrées ne seraient
     * jamais nettoyées autrement (isLimited n'est plus appelé pour un émetteur
     * déconnecté), d'où une croissance illimitée de la Map au fil des rotations de
     * room. Suppression pendant l'itération d'une Map : sûre par spec.
     *
     * @param {number} windowStart
     */
    const sweep = (windowStart) => {
        for (const [key, timestamps] of windows) {
            if (!timestamps.some(ts => ts > windowStart)) {
                windows.delete(key)
            }
        }
    }

    /**
     * Consomme un jeton pour `key`, ou signale que le plafond est atteint.
     *
     * ⚠️ Un appel bloqué ne consomme PAS de jeton : sans ça, une boucle serrée
     * repousserait indéfiniment la sortie de fenêtre et le plafond deviendrait un
     * bannissement définitif.
     *
     * @param {string} key
     * @returns {boolean} true si l'appel doit être abandonné
     */
    const isLimited = (key) => {
        const now = Date.now()
        const windowStart = now - windowMs

        // Balayage global throttlé : évite la fuite mémoire sur clés disparues.
        if (now - lastSweep >= windowMs) {
            lastSweep = now
            sweep(windowStart)
        }

        let timestamps = windows.get(key) ?? []
        // Purge les timestamps hors de la fenêtre glissante
        timestamps = timestamps.filter(ts => ts > windowStart)

        if (timestamps.length >= max) {
            windows.set(key, timestamps)
            return true
        }

        timestamps.push(now)
        windows.set(key, timestamps)
        return false
    }

    /** Vide tout l'état (tests, teardown explicite). */
    const reset = () => {
        windows.clear()
        lastSweep = 0
    }

    /** Nombre de clés actuellement suivies (observabilité / tests du sweep). */
    const size = () => windows.size

    return { isLimited, reset, size }
}
