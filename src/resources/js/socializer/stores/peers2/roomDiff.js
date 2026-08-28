/**
 * roomDiff.js — Le diff de composition d'une room, et rien d'autre.
 *
 * Extrait dans son propre fichier pour la raison qui a valu le même sort à `keys.js` : la
 * sémantique est un CONTRAT partagé entre l'action du store (`computeRoomDiff`, la
 * production) et le double de test (`createMockContext`, qui doit décider comme elle).
 * C'est contre le double que `usePeerConnections.test.js` asserte arrivées et départs —
 * deux implémentations de ce diff divergeraient donc en rendant verts des tests qui ne
 * prouveraient plus rien de la production. Le paquet a déjà payé cette panne exacte avec
 * `_signalQueue` / `_signalQueueRooms` (cf. docs/architecture/tests.md#pièges-de-mock).
 */

/**
 * La composition d'un contexte qui n'a jamais rien déclaré.
 *
 * GELÉ, et ce n'est pas de la décoration : c'est la valeur que rend la lecture d'une clé
 * absente, donc celle que voit tout code qui lit la composition d'un contexte encore muet.
 * Un `push` dessus lève au lieu d'écrire dans un tableau que personne ne relira — et
 * `reactive()` rend un objet non extensible tel quel, sans le proxifier, donc le gel
 * survit à la traversée du store.
 *
 * Identité stable, aussi : un `[]` neuf à chaque lecture ferait d'un `watch` sur la
 * composition un déclencheur à chaque tour.
 */
export const EMPTY_MEMBERS = Object.freeze([])

/**
 * Qui vient d'arriver, qui vient de partir.
 *
 * En slugs des deux côtés : le store ne connaît pas les objets utilisateur de la liste de
 * présence, et n'a aucune raison de les connaître. C'est à l'appelant de retraduire les
 * arrivants en objets s'il en a besoin — `usePeerConnections` le fait, parce que la forme
 * publique de `getRoomUsersDiff` le promet.
 *
 * @param {string[]} previous  Composition déclarée jusqu'ici
 * @param {string[]} next      Composition observée à ce tour
 * @returns {{ newSlugs: string[], removedSlugs: string[] }}
 */
export function diffRoomMembers(previous = [], next = []) {
    const before = Array.isArray(previous) ? previous : []
    const after = Array.isArray(next) ? next : []

    return {
        newSlugs: after.filter(slug => !before.includes(slug)),
        removedSlugs: before.filter(slug => !after.includes(slug)),
    }
}
