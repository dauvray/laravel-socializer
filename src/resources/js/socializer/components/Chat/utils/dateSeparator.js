/**
 * shouldShowDateSeparator — décide d'afficher un séparateur de date avant un message.
 *
 * Fonction pure (aucune dépendance Vue) : prend la liste des messages et l'index
 * courant, et renvoie `true` si le message d'index `index` ouvre un nouveau jour
 * par rapport au précédent.
 *
 * @param {Array<{created_at: string}>} messages - liste ordonnée des messages
 * @param {number} index - index du message à tester dans `messages`
 * @param {boolean} [displaySeparator=true] - désactive globalement les séparateurs
 * @returns {boolean}
 */
export function shouldShowDateSeparator(messages, index, displaySeparator = true) {
    if (displaySeparator === false) return false

    // Toujours afficher le séparateur pour le premier message.
    if (index === 0) return true

    const currentDate = new Date(messages[index].created_at).toDateString()
    const previousDate = new Date(messages[index - 1].created_at).toDateString()

    // Afficher le séparateur si le jour diffère du message précédent.
    return currentDate !== previousDate
}
