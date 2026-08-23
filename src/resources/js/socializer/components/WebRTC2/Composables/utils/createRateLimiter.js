/**
 * createRateLimiter.js — Fenêtre glissante par clé (rate limiting WebRTC2)
 *
 * Source de vérité unique de la mécanique de plafonnement du package. Trois chemins
 * la consomment, avec des clés et des dimensionnements différents :
 *   - `usePeerTransport` (hub star, messages) → clé = peerId PeerJS entrant réel
 *   - `usePeerTransport` (hub star, octets retransmis) → même clé, mode PONDÉRÉ
 *   - `usePeerCore` (`/ask-to-peer-id`) → clé = `slug|room|connectionType`
 *
 * LE MODE PONDÉRÉ N'EST PAS UN SECOND SYSTÈME. Le plafond porte sur la somme des
 * poids, et un appel sans poids vaut 1 : compter des appels est donc le cas
 * particulier où tous les poids valent 1. C'est ce qui permet au hub de plafonner
 * `octets × destinataires` sans Map de timestamps ad hoc à côté.
 *
 * Une instance porte son propre état ; c'est l'appelant qui décide de sa portée
 * (module-level pour survivre à un mount/unmount, ou locale pour être isolée).
 */

/**
 * Crée un limiteur à fenêtre glissante.
 *
 * @param {Object} options
 * @param {number} options.windowMs  Largeur de la fenêtre glissante (ms)
 * @param {number} options.max       Somme des poids autorisée dans la fenêtre
 *                                   (= nombre d'appels si aucun poids n'est passé)
 * @returns {{ isLimited: (key: string, weight?: number) => boolean, reset: () => void, size: () => number }}
 */
export function createRateLimiter({ windowMs, max }) {

    // Fenêtre glissante par clé : chaque entrée est un tableau de `{ ts, weight }`.
    const windows = new Map()

    // Horodatage du dernier balayage global, pour throttler la purge des entrées
    // devenues inactives à au plus une fois par fenêtre glissante.
    let lastSweep = 0

    /**
     * Purge les clés dont toutes les entrées ont expiré : elles ne seraient jamais
     * nettoyées autrement (isLimited n'est plus appelé pour un émetteur déconnecté),
     * d'où une croissance illimitée de la Map au fil des rotations de room.
     * Suppression pendant l'itération d'une Map : sûre par spec.
     *
     * @param {number} windowStart
     */
    const sweep = (windowStart) => {
        for (const [key, entries] of windows) {
            if (!entries.some(entry => entry.ts > windowStart)) {
                windows.delete(key)
            }
        }
    }

    /**
     * Consomme `weight` jetons pour `key`, ou signale que le plafond est atteint.
     *
     * ⚠️ Un appel bloqué ne consomme PAS de jeton : sans ça, une boucle serrée
     * repousserait indéfiniment la sortie de fenêtre et le plafond deviendrait un
     * bannissement définitif.
     *
     * ⚠️ LE CONTRÔLE PORTE SUR LE TOTAL DÉJÀ POSÉ, jamais sur « total + weight ».
     * Conséquence délibérée : un appel dont le poids dépasse à lui seul le plafond
     * passe quand la fenêtre est vide, et bloque tout le reste de la fenêtre. C'est
     * ce qui autorise un gros fan-out isolé côté hub tout en coupant l'amplification
     * SOUTENUE — le vrai risque. Tester `total + weight > max` refuserait le premier
     * message d'une grande room au lieu du centième.
     *
     * @param {string} key
     * @param {number} [weight=1]  Coût de l'appel (1 = un appel, N = N octets…)
     * @returns {boolean} true si l'appel doit être abandonné
     */
    const isLimited = (key, weight = 1) => {
        const now = Date.now()
        const windowStart = now - windowMs

        // Balayage global throttlé : évite la fuite mémoire sur clés disparues.
        if (now - lastSweep >= windowMs) {
            lastSweep = now
            sweep(windowStart)
        }

        // Purge les entrées hors de la fenêtre glissante
        const entries = (windows.get(key) ?? []).filter(entry => entry.ts > windowStart)
        const total = entries.reduce((sum, entry) => sum + entry.weight, 0)

        if (total >= max) {
            windows.set(key, entries)
            return true
        }

        entries.push({ ts: now, weight })
        windows.set(key, entries)
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
