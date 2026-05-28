# WebRTC2 — Conventions issues du refacto initial (mai 2026)

> Historique exhaustif des ~70 fixes P0/P1 disponible dans git
> (`git log -- vendor/dauvray/laravel-socializer/src/resources/js/socializer/components/WebRTC2/`).
> Ce fichier conserve uniquement les **conventions à respecter** qui ne sont
> pas évidentes à la lecture du code et qu'une refacto pourrait casser sans le savoir.

## Bornes & limites (toutes dans `webrtc2.config.js`)

- `MAX_PEERS_PER_ROOM = 8` — mesh sature au-delà (CPU + bande passante navigateur)
- `MAX_REMOTE_STREAMS = 12` + `STREAM_STALE_MS = 300_000` — éviction LRU dans `remoteStreamsMap` (anti-leak)
- `MAX_PAYLOAD_BYTES = 64 * 1024` — garde anti-DoS hub star (émission + réception)
- `HUB_MAX_MESSAGES_PER_WINDOW = 20` / `HUB_RATE_WINDOW_MS = 1000` — rate-limit `forwardStarMessage`
- `MAX_RETRY_ATTEMPTS = 8` / `MAX_RECONNECT_ATTEMPTS = 8` — bornes anti-boucle infinie

## Conventions de code

- **IDs de session** : `crypto.randomUUID()` — jamais `Math.random()` (cf. `ensureCurrentCallRoomId`)
- **PeerId local** : `ctx.peerStore.getLocalPeerId` — jamais le triple fallback historique `localPeer?.id || localPeer?._id || lastLocalPeerId`
- **Retry peer** : un seul système, `usePeerRetry` — pas de Map `inviteRetries` parallèle
- **Clé `remoteStreamsMap`** : `slug+type` canonique, passe unique (la double-passe historique venait d'une clé non fiable)
- **Flags sur objets PeerJS tiers** : interdit (pas de `conn.__ctxListenersBound` etc.) — utiliser un `WeakSet` interne
- **API orchestrateur** : façade explicite minimale — pas de `...spread` des composables internes
- **Stream local** : attente via `watch` réactif — pas de polling `while (!stream && attempts < N)`
- **Signalisation prête** : `watch` sur `meStore.getMe?.slug` + `peerStore.localPeer?.id` — pas de `setTimeout` polling

## Cleanup obligatoire

- Tout `watch()` ⇒ `unwatch()` dans `onUnmounted`
- `setUpConnectionListeners` ⇒ retourne un unsub appelé au démontage du contexte
- Timers `setTimeout` de backoff ⇒ référence stockée et annulée dans `_destroyPeerSingleton`
- `contextRegistry` ⇒ entrée supprimée dans `onUnmounted` **seulement si elle appartient toujours au contexte** (voir [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — last-write-wins volontaire)

## Pour aller plus loin

- Décisions sécurité + modèle de confiance : [SECURITY_AUDIT.md](SECURITY_AUDIT.md)
- TODO actifs (améliorations pérennisation) : [TODOLIST.md](TODOLIST.md)
- Vue d'ensemble du module : [README.md](README.md)
