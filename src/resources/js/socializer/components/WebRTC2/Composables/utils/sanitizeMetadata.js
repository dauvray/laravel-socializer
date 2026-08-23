/**
 * sanitizeMetadata.js — Sanitization des métadonnées PeerJS entrantes
 *
 * Les métadonnées attachées à une `DataConnection` ou `MediaConnection` PeerJS
 * proviennent du réseau (champ contrôlé par le pair distant). Avant d'être
 * utilisées comme clés de store, paramètres de logging ou conditions de
 * routage, chaque champ doit être validé contre les guards de format existants
 * (`VALID_CONNECTION_TYPES`, `SLUG_PATTERN`) — sinon un pair malveillant peut
 * polluer le store avec des clés forgées ou injecter du contenu non borné dans
 * les logs.
 *
 * Source de vérité unique pour la sanitization des champs consommés en lecture
 * depuis `conn.metadata`. Couvre la faille [FAIBLE] de l'audit du 2026-05-20
 * (`conn.metadata` non sanitisé avant usage).
 */
import { MAX_METADATA_NAME_LENGTH, VALID_CONNECTION_TYPES } from '../../webrtc2.config.js'

/**
 * Valide et retourne le champ `metadata.type` (type d'appel/connexion).
 * Retourne la valeur si elle appartient à VALID_CONNECTION_TYPES, sinon null.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function sanitizeMetadataType(value) {
    if (typeof value !== 'string') return null
    return VALID_CONNECTION_TYPES.has(value) ? value : null
}

/**
 * Borne un nom d'affichage reçu d'un pair distant (`metadata.fromName`).
 *
 * TRONQUE au lieu de rejeter, contrairement à `sanitizeMetadataType` : un type hors
 * liste blanche n'a aucune valeur de repli utilisable, un nom trop long en a une —
 * lui-même, coupé. Faire disparaître le pair de l'interface serait une réponse plus
 * dure que le problème (une vignette large).
 *
 * Rend `null` sur non-string ou chaîne vide, à charge de l'appelant de poser son
 * repli — même contrat que `sanitizeMetadataType`.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function sanitizeMetadataName(value) {
    if (typeof value !== 'string') return null

    const trimmed = value.trim()

    return trimmed === '' ? null : trimmed.slice(0, MAX_METADATA_NAME_LENGTH)
}
