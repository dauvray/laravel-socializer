/**
 * webrtc2.config.js
 *
 * Centralise toutes les constantes et endpoints HTTP utilisés par les composables WebRTC2.
 * Modifier ici suffit à mettre à jour l'ensemble du système après une refacto backend.
 */

// ─── Limites réseau ────────────────────────────────────────────────────────
/**
 * Nombre maximum de peers simultanés par room en topologie mesh.
 * WebRTC full-mesh est raisonnable jusqu'à ~8 participants ; au-delà le navigateur
 * sature (CPU + bande passante). Toute tentative de connexion supplémentaire sera
 * refusée avec un avertissement dans la console.
 */
export const MAX_PEERS_PER_ROOM = 8

// ─── Retry peer-to-peer (usePeerRetry) ───────────────────────────────────
/**
 * Nombre maximum de tentatives de connexion vers un peer avant abandon.
 * Backoff exponentiel : 1s · 2s · 4s · 8s · … · 10s (max) + jitter 0–300ms.
 * ~6 min de fenêtre maximale avec 8 tentatives.
 */
export const MAX_RETRY_ATTEMPTS = 8

// ─── Reconnexion PeerJS ───────────────────────────────────────────────────
/**
 * Nombre maximum de tentatives de reconnexion au serveur PeerJS avant abandon.
 * Backoff exponentiel : 1s · 2s · 4s · 8s · 16s · 30s (max) par tentative.
 */
export const MAX_RECONNECT_ATTEMPTS = 8

// ─── Destruction différée du Peer singleton ───────────────────────────────
/**
 * Délai (ms) avant destruction effective du Peer singleton après que le dernier
 * consommateur s'est démonté. Si un nouveau consommateur appelle setLocalPeer()
 * dans ce délai, la destruction est annulée et le peer existant est réutilisé.
 * Valeur 0 = destruction immédiate.
 */
export const PEER_DESTROY_DELAY_MS = 10_000

// ─── Rate limiting hub (topologie star) ───────────────────────────────────
/**
 * Fenêtre glissante utilisée pour le rate limiting de forwardStarMessage().
 * Si un client envoie plus de HUB_MAX_MESSAGES_PER_WINDOW messages dans
 * cette fenêtre, l'excédent est abandonné avec un avertissement console.
 */
export const HUB_RATE_WINDOW_MS = 1000
export const HUB_MAX_MESSAGES_PER_WINDOW = 20

// ─── Types de connexion valides ────────────────────────────────────────────
/**
 * Ensemble des types de connexion PeerJS reconnus par le système WebRTC2.
 * Utilisé pour valider les payloads avant d'ouvrir une connexion.
 */
export const VALID_CONNECTION_TYPES = new Set(['data', 'stream', 'screen', 'visio', 'vocal'])

// ─── Endpoints HTTP (signaling backend) ────────────────────────────────────
export const ENDPOINTS = {
    /** Demander le peerId d'un utilisateur distant (connexion directe) */
    ASK_TO_PEER_ID: '/ask-to-peer-id',

    /** Répondre à une demande de peerId (connexion directe) */
    RESPONSE_TO_PEER_ID: '/response-to-peer-id',

    /** Envoyer une invitation d'appel à un utilisateur (avec retry) */
    SEND_ALERT_TO_USER: '/send-alert-to-user',

    /** Répondre à une demande d'autorisation d'appel (accepter / refuser) */
    RESPONSE_TO_AUTHORIZATION_PEER: '/response-to-authorization-peer',

    /** Notifier un peer de la fermeture de la connexion */
    CLOSE_CONNECTION_TO_PEER_ID: '/close-connection-to-peer-id',
}
