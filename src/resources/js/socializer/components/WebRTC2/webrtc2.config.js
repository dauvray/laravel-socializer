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
 * Budget d'octets RETRANSMIS par le hub, par expéditeur et par fenêtre.
 *
 * ⚠️ Ce n'est pas une taille de message, c'est le coût réel d'une retransmission :
 * `octets du payload × nombre de destinataires`. Les deux plafonds ci-dessus sont
 * par expéditeur et par message ; leur PRODUIT par le fan-out n'était borné par
 * rien, et star est justement la topologie des grandes rooms — à 100 membres,
 * 20 msg/s × 64 Ko faisait sortir ~128 Mo/s d'un hub qui est un onglet navigateur.
 *
 * Dimensionnement : 1 Mio/s ≈ 8 Mbit/s d'émission soutenue, soit déjà l'ordre de
 * grandeur d'un lien montant résidentiel. Le trafic star légitime (chat, présence,
 * traits de tableau blanc) est deux ordres de grandeur en dessous.
 *
 * ⚠️ Le plafond est PAR EXPÉDITEUR, pas global au hub : un budget partagé serait un
 * déni de service sur les pairs honnêtes (le premier à dépenser prive les autres).
 * La somme de N expéditeurs reste donc une borne connue — cf. `securite.md`.
 */
export const HUB_MAX_BYTES_PER_WINDOW = 1024 * 1024

/**
 * Taille maximale (octets) d'un payload de données, mesurée en octets UTF-8 de sa
 * sérialisation JSON (ou en taille brute pour Blob/File/ArrayBuffer/TypedArray).
 *
 * Trois points d'application, une seule mécanique (`utils/payloadSize.js`) : émission
 * mesh (`sendData`), retransmission hub (`forwardStarMessage`) et réception
 * (`handleData`). Le contrôle en réception n'est pas redondant — les deux premiers
 * sont contournables par un pair qui retire le check de son propre client.
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
 * Durée (ms) au bout de laquelle l'UI cesse de signaler « en attente du flux » pour un
 * pair qui a ANNONCÉ un flux jamais arrivé (cf. useAwaitedStreams).
 *
 * ⚠️ FILET, pas mécanisme. Le fait « ce pair diffuse » vient désormais d'une annonce
 * protocolaire (`BROADCAST_STATE` sur le data channel, cf. useBroadcastPresence), de la
 * trace d'un appel one-way entrant (usePeerTransport), ou de l'`isBroadcasting` embarqué
 * sur les deux routes de peerId (usePeerCore) : un pair silencieux n'est plus attendu du
 * tout, donc ce délai ne s'applique plus jamais à un non-diffuseur. Il ne reste que pour
 * le cas « annonce reçue, flux qui n'arrivera pas » (canal data vivant, chemin média
 * cassé), où une vignette tournerait sinon à vie — le troisième chemin élargit d'ailleurs
 * ce cas, puisqu'il annonce avant même qu'une connexion existe. Une nouvelle annonce du
 * même pair réarme l'attente.
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

// ─── Bail des peerId distants ─────────────────────────────────────────────
/**
 * Durée (ms) pendant laquelle un peerId distant appris est jugé assez frais pour qu'on
 * COMPOSE dessus. Passé ce délai, `peerStore.getDialableRemotePeerId` ne le rend plus et
 * les deux points de décision de `useConnectionPool` redemandent la signalisation au lieu
 * d'appeler un numéro dont plus rien n'atteste qu'il existe encore.
 *
 * ⚠️ **Le bail ne gouverne que la confiance, jamais l'existence de l'entrée.** Le même
 * mapping sert d'allowlist au chemin (b) de `_isAuthorizedIncomingPeer` et d'index
 * anti-usurpation par résolution inverse : `getRemotePeerId` et `getSlugByRemotePeerId`
 * sont donc aveugles au bail, par construction (cf. `securite.md`). Une expiration qui
 * supprimerait refermerait la visio 1-à-1 hors room ; une résolution inverse périmable
 * serait un contournement qu'un attaquant n'aurait qu'à attendre.
 *
 * Le bail est **renouvelé sur preuve** : `connectToPeer` écrit le mapping à chaque réponse
 * de signalisation reçue (et avant ses gardes, à dessein), donc une room saine ne paie
 * jamais d'aller-retour supplémentaire.
 *
 * Dimensionnement — quatre relations, la première étant une contrainte d'ordre dure :
 * - **> l'horizon du moteur de retry (≈ 55 s)** : `MAX_RETRY_ATTEMPTS` = 8 avec
 *   `min(1000·2^n, 10_000)` place les tentatives à t = 1, 3, 7, 15, 25, 35, 45, 55 s. Un
 *   bail plus court ferait changer d'avis le moteur EN COURS de chaîne, alors que son
 *   contrat est d'insister sur cet id jusqu'à l'abandon.
 * - **≈ `alive_timeout` du serveur PeerJS (60 s)** : passé ce délai la socket de l'ancien
 *   `Peer` distant n'existe plus côté serveur — un id plus vieux que le bail n'a donc plus
 *   de contrepartie, même dans l'hypothèse la plus optimiste. C'est ce qui rend 60 s
 *   signifiant plutôt qu'arbitraire (cf. la violation `peer-orphelin` de
 *   `peerStateViolations`).
 * - **5 × `SIGNALING_STALE_MS`** : la re-demande qui suit l'expiration est elle-même
 *   cadencée par ce throttle ; à quelques multiples près, expiration et étranglement
 *   deviendraient indiscernables.
 * - **6 × `PEER_DESTROY_DELAY_MS`** : le bail doit survivre à un démontage/remontage
 *   ordinaire de provider (navigation SPA), sinon il coûte un aller-retour pour rien.
 *
 * Il n'étrangle pas le plafond de cadence : le bail ne change pas le NOMBRE de tentatives,
 * seulement la branche qu'une tentative prend. Au pire (chaque POST échoue, donc aucun
 * drapeau `waiting` posé), les tentatives de la première fenêtre sont t = 1, 3, 7 s, soit
 * exactement les 3 de `ASK_PEER_MAX_REQUESTS_PER_WINDOW` ; ensuite les tentatives sont
 * espacées de 10 s.
 */
export const REMOTE_PEER_ID_LEASE_MS = 60_000

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

// ─── Attente de la présence (createPeerContext.waitForPresenceSync) ───────
/**
 * Durée maximale (ms) d'attente de la PREMIÈRE synchronisation de présence d'un
 * contexte, avant de conclure sur un pair que rien n'autorise encore.
 *
 * ⚠️ Ce n'est pas un délai de politesse : `usersInRoom` vide ne dit pas « ce pair n'est
 * pas membre », il dit « je ne sais pas encore qui est membre ». Les deux gardes
 * d'admission (`responseRemotePeerConnection`, `_isAuthorizedIncomingPeer`) doivent
 * distinguer les deux, sans quoi tout contact légitime reçu pendant le démarrage d'un
 * contexte est refusé — et aucun des deux refus n'est rattrapable (cf.
 * `scenarios/lateJoiner.test.js`, cas « la demande d'A précède sa présence »).
 *
 * Dimensionné sous SIGNALING_STALE_MS (12 s) : la re-demande du pair distant reste le
 * filet extérieur, cette attente n'est que le chemin rapide.
 *
 * L'attente est mémoïsée par contexte : un contexte sans canal de présence (le
 * `data-app` de Notifications.vue, qui n'ouvre que des appels directs) ne la paie
 * qu'une fois, jamais par connexion refusée.
 */
export const PRESENCE_SYNC_TIMEOUT_MS = 5_000

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

// ─── Rate limiting client sur /ask-to-peer-id (usePeerCore) ───────────────
/**
 * Plafond d'émission de `requestRemotePeerConnection`, par cible
 * (`slug|room|connectionType`) et par fenêtre glissante.
 *
 * ⚠️ Distinct du garde `waiting` / SIGNALING_STALE_MS, qui vit dans le store et
 * saute dès qu'une entrée est purgée — notamment par `invalidateRemotePeerId`, qui
 * supprime le flag *volontairement* pour ne pas étrangler la re-demande après un
 * `peer-unavailable`. Ce chemin est une boucle (`peerUnavailableSignal` → watch de
 * `useConnectionPool` → POST immédiat) : sans plafond indépendant du store et du
 * cycle de vie du composant, rien n'en borne la cadence.
 *
 * Dimensionnement : la cadence légitime sur une même cible est d'~1 demande par
 * SIGNALING_STALE_MS (12 s) ; 3 par 10 s laisse la marge des rafales de recovery
 * tout en transformant une boucle en 3 requêtes/10 s au lieu d'un flot continu.
 *
 * Volontairement **par cible et non global** : un join de room mesh émet
 * légitimement jusqu'à 14 demandes dans le même tick (7 pairs × type principal +
 * écran, cf. MAX_PEERS_PER_ROOM), qu'un cap global mal dimensionné casserait.
 */
export const ASK_PEER_RATE_WINDOW_MS = 10_000
export const ASK_PEER_MAX_REQUESTS_PER_WINDOW = 3

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

// ─── Métadonnées de connexion entrantes ────────────────────────────────────
/**
 * Taille maximale (octets) de l'objet `conn.metadata` accepté à l'admission d'une
 * connexion entrante, mesurée par la même mécanique que les payloads
 * (`utils/payloadSize.js`).
 *
 * ⚠️ Le garde va AVANT toute autre chose sur le chemin d'admission, y compris avant
 * les `console.warn` de non-résolution de contexte : ceux-ci journalisent l'objet
 * metadata ENTIER, et c'est le pair distant qui décide de les déclencher — il
 * contrôle `callbackKey`, donc le fait qu'aucun contexte ne se résolve.
 *
 * Dimensionnement : la metadata nominale (`_buildPeerConnectionConfig`) porte 8
 * champs dont deux slugs bornés à 100 caractères, soit moins de 500 octets. 4 Ko
 * laissent huit fois la marge et restent 16 fois sous `MAX_PAYLOAD_BYTES`.
 */
export const MAX_METADATA_BYTES = 4 * 1024

/**
 * Longueur maximale d'un nom d'affichage reçu d'un pair distant
 * (`metadata.fromName`, rendu par `MediaBroadcastPlayer`).
 *
 * Tronqué et non rejeté : c'est une étiquette de vignette, un nom trop long doit
 * s'afficher coupé et non faire disparaître le pair. Il n'y a pas de XSS à ce
 * niveau (aucun `v-html` ni `innerHTML` dans le module, Vue échappe
 * l'interpolation) — ce qui est borné, c'est la mise en page et les logs.
 */
export const MAX_METADATA_NAME_LENGTH = 64

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

    /**
     * Configuration ICE (STUN/TURN) calculée par le serveur.
     *
     * Seule route du catalogue qui n'est PAS de la signalisation : elle ne relaie rien vers un
     * autre utilisateur. Elle est publique et rend toujours 200 — STUN seul pour un invité,
     * STUN + TURN pour une session authentifiée (`WebRTCController::getIceServers`).
     */
    ICE_SERVERS: '/get-ice-servers',
}

/**
 * Repli lorsque `/get-ice-servers` est injoignable ou illisible.
 *
 * Exactement ce qui était en dur dans le bundle avant que la config passe par le serveur : la
 * dégradation est « plus de relais TURN », jamais « plus de WebRTC ». Un pair derrière un NAT
 * permissif se connecte encore ; seul le NAT symétrique perd sa session.
 */
export const STUN_ONLY_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

/**
 * Délai au-delà duquel on renonce à la configuration ICE du serveur et on prend
 * `STUN_ONLY_ICE_SERVERS`.
 *
 * ⚠️ Ce n'est pas une précaution décorative : `AjaxService.load` d'estarter a DEUX chemins qui ne
 * résolvent NI ne rejettent jamais — 401/419 (`document.location.reload()` sans `reject`) et 302
 * (`window.location.href` sans `reject`). Comme l'appel est désormais `await`é avant `new Peer`,
 * une requête qui pend voudrait dire « plus jamais de Peer dans cet onglet ». Le timeout
 * transforme cette panne totale en dégradation en STUN.
 */
export const ICE_FETCH_TIMEOUT_MS = 3000

// ─── Rafraîchissement du credential TURN ────────────────────────────────────────
// Le credential servi par `/get-ice-servers` est éphémère (TURN REST API, signé par
// utilisateur, TTL annoncé dans `credential_ttl`). Or le `Peer` est un singleton
// d'onglet que rien ne détruit tant que la coquille SPA vit, et il ne récupérait la
// configuration ICE qu'une fois par cycle de vie : passé le TTL, l'appel en cours
// tenait — coturn a déjà sa clé de session — mais TOUTE NOUVELLE ALLOCATION échouait.
// Symptôme : « la visio ne passe plus, un F5 la répare ».
//
// D'où le minuteur de `_scheduleIceRefresh` (usePeerTransport), dont ces cinq
// constantes fixent le dimensionnement.

/**
 * De combien on rafraîchit AVANT l'échéance.
 *
 * Il faut couvrir l'aller-retour HTTP et le fait que coturn juge le credential à l'instant de
 * l'allocation, pas à celui du rafraîchissement : viser l'échéance pile laisserait une fenêtre où
 * un nouvel appel part avec un credential qui vient d'expirer. Cinq minutes sur un TTL de 24 h,
 * c'est 0,3 % de marge pour supprimer ce cas.
 */
export const ICE_REFRESH_MARGIN_MS = 300_000

/**
 * Plancher du délai, marge déduite.
 *
 * `credential_ttl` est un réglage d'hôte : rien n'empêche un déployeur d'y mettre 30 s. Sans
 * plancher, `ttl - MARGE` deviendrait négatif et `setTimeout` déclencherait immédiatement — une
 * boucle chaude sur `/get-ice-servers`, c'est-à-dire une panne pire que celle qu'on ferme. Le
 * plancher préfère un rafraîchissement légèrement tardif à un martèlement.
 */
export const ICE_REFRESH_MIN_DELAY_MS = 60_000

/**
 * Plafond du délai — la borne 32 bits signés de `setTimeout`, soit ~24,8 jours.
 *
 * ⚠️ Ce n'est pas une précaution théorique : au-delà de cette valeur, `setTimeout` ne repousse pas,
 * il **déclenche immédiatement**. Un `COTURN_CREDENTIAL_TTL` réglé sur un mois — parfaitement
 * plausible pour qui veut « ne plus y penser » — produirait donc le martèlement que le plancher
 * ci-dessus cherche à éviter, par l'autre extrémité.
 */
export const ICE_REFRESH_MAX_DELAY_MS = 2_147_483_647

/**
 * Délai avant nouvelle tentative quand un rafraîchissement n'a rien rapporté d'exploitable.
 *
 * Cas visé : la route répond mal (500, session expirée, proxy) pendant l'échéance. On ne réécrit
 * alors RIEN — cf. `_refreshIceConfig` — et on retente peu après plutôt que d'attendre le TTL
 * suivant, qui n'arrivera jamais puisque le credential est déjà en train d'expirer.
 */
export const ICE_REFRESH_RETRY_MS = 60_000

/**
 * Nombre de tentatives infructueuses consécutives au-delà duquel on abandonne.
 *
 * Borné, et pas seulement par politesse envers la route : `routes.public.php` documente que
 * `/get-ice-servers` n'a PAS de `throttle`, et que la condition de réouverture est « un credential
 * court ET re-demandé ». Une reprise non bornée sur une route morte serait exactement ce
 * re-demandé-là. L'abandon rend le comportement d'avant ce mécanisme — un F5 répare — ce qui est
 * une dégradation, pas une régression.
 */
export const ICE_REFRESH_MAX_RETRIES = 3

// ─── Provide/inject (MediaBroadcastProvider) ────────────────────────────────────
export const WEBRTC_API_KEY = Symbol('webrtcApi')