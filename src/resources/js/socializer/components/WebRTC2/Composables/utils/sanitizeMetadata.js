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
import { VALID_CONNECTION_TYPES } from '../../webrtc2.config.js'

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
