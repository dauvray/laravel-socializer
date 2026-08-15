/**
 * keys.js — Fabrication des clés composites du store peers2.
 *
 * Extrait dans son propre fichier parce que la clé est un CONTRAT partagé entre les
 * actions (écriture) et les getters (lecture) : deux implémentations, même normalisation.
 * Une divergence d'un seul caractère (`String(null)` vs `''`) rendrait toute lecture
 * infructueuse sans jamais lever d'erreur — la panne la plus chère du module.
 */

/**
 * Clé d'une demande de peerId en vol.
 *
 * Une demande appartient à un CONTEXTE, pas à un utilisateur : sur une page qui monte
 * plusieurs `MediaBroadcastProvider`, « j'ai demandé le peerId de bob » n'a aucun sens —
 * seul « je l'ai demandé pour la room R en type T » en a un. Indexer sur le slug seul
 * faisait qu'un contexte confisquait la demande des autres.
 *
 * @param {string} userSlug
 * @param {string|null} room
 * @param {string|null} type
 * @returns {string}
 */
export function waitingPeerIdKey(userSlug, room = null, type = null) {
    return `${userSlug ?? ''}|${room ?? ''}|${type ?? ''}`
}
