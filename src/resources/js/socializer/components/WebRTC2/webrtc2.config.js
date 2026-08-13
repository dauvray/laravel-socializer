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

/**
 * Taille maximale (octets) d'un payload retransmis par le hub en topologie star.
 * Concerne les payloads JSON et binaires (Blob/File/ArrayBuffer/TypedArray).
 * Au-dela, le message est rejete pour limiter les risques d'amplification DoS.
 */
export const MAX_PAYLOAD_BYTES = 64 * 1024

// ─── Streams distants (remoteStreamsMap) ──────────────────────────────────
/**
 * Nombre maximum de streams distants simultanés dans remoteStreamsMap.
 * Correspond environ au nombre max de pairs en mesh (~13 pairs → 12 streams distants).
 * Au-delà, l'entrée la plus ancienne est évincée.
 */
export const MAX_REMOTE_STREAMS = 12

/**
 * Durée (ms) après laquelle un stream distant sans activité est considéré stale
 * et éligible à l'éviction dans _cleanupStaleRemoteStreams().
 * Défaut : 5 minutes.
 */
export const STREAM_STALE_MS = 300_000

/**
 * Durée (ms) pendant laquelle l'UI signale « en attente du flux » pour un pair présent
 * dans la room dont aucun flux n'est encore arrivé (cf. useAwaitedStreams).
 *
 * ⚠️ C'est nécessairement une heuristique : un récepteur ne peut PAS savoir localement
 * qu'un pair diffuse. `usersInRoom` liste tous les présents, diffuseurs ou non, et pour
 * un appel one-way (`stream`/`screen`) le récepteur répond par `call.answer()` sans
 * stocker la connexion — il n'existe donc aucune trace observable avant l'événement
 * `stream`, qui est justement le moment où le flux arrive. Passé ce délai, on considère
 * que le pair ne diffuse pas, plutôt que de laisser un spinner tourner indéfiniment.
 *
 * Dimensionné au-dessus du backoff de connexion (MAX_RETRY_ATTEMPTS plafonné à 10 s par
 * tentative) pour ne pas abandonner avant que l'établissement ait eu sa chance.
 */
export const AWAITED_STREAM_TIMEOUT_MS = 20_000

// ─── Signalisation stale ──────────────────────────────────────────────────
/**
 * Durée (ms) après laquelle une entrée "waiting" dans le store de signalisation
 * (getWaitingRemotePeerId) est considérée stale.
 * Utilisé dans deux sens complémentaires :
 *   - usePeerOrchestrator : déclenche une nouvelle demande si l'entrée est trop vieille.
 *   - usePeerCore         : empêche le re-envoi si l'entrée est trop récente (anti-spam).
 */
export const SIGNALING_STALE_MS = 12_000

// ─── Backoff exponentiel reconnexion PeerJS ───────────────────────────────
/**
 * Délai de base (ms) pour le backoff exponentiel sur l'événement 'disconnected'.
 * La formule appliquée est : min(BASE * 2^(attempt-1), MAX_DELAY).
 */
export const RECONNECT_BASE_DELAY_MS = 1_000

/**
 * Délai maximum (ms) pour le backoff exponentiel de reconnexion PeerJS.
 * Au-delà, le délai est plafonné à cette valeur.
 */
export const RECONNECT_MAX_DELAY_MS = 30_000

// ─── Attente stream local (usePeerTransport) ──────────────────────────────
/**
 * Durée maximale (ms) d'attente du stream local via watch réactif
 * avant d'abandonner la réponse à un appel entrant.
 */
export const STREAM_WAIT_TIMEOUT_MS = 5_000

// ─── Attente identité locale (createPeerContext.waitForMeReady) ──────────
/**
 * Durée maximale (ms) d'attente que `meStore.getMe.slug` ET
 * `peerStore.lastLocalPeerId` soient disponibles avant d'abandonner.
 * Surchargeable via `options.meReadyTimeoutMs` à la création du contexte.
 */
export const ME_READY_TIMEOUT_MS = 15_000

// ─── Invitations d'appel (usePeerCore) ────────────────────────────────────
/**
 * Nombre maximum d'invitations d'appel simultanément en attente de réponse
 * (taille max de la Map userSlugToInviteId).
 * Au-delà, les nouvelles invitations sont ignorées pour éviter les fuites.
 */
export const MAX_INVITE_RETRIES = 20

// ─── Types de connexion valides ────────────────────────────────────────────
/**
 * Ensemble des types de connexion PeerJS reconnus par le système WebRTC2.
 * Utilisé pour valider les payloads avant d'ouvrir une connexion.
 */
export const VALID_CONNECTION_TYPES = new Set(['data', 'stream', 'screen', 'visio', 'vocal'])

// ─── Validation des slugs ──────────────────────────────────────────────────
/**
 * Format autorisé pour un slug utilisateur : alphanumérique + `_ - .`, de 1 à 100
 * caractères. Source de vérité unique partagée par usePeerOrchestrator et
 * usePeerTransport (rejet des slugs forgés avant routage/retransmission).
 */
export const SLUG_PATTERN = /^[a-zA-Z0-9_\-.]{1,100}$/

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

// ─── Provide/inject (MediaBroadcastProvider) ────────────────────────────────────
export const WEBRTC_API_KEY = Symbol('webrtcApi')