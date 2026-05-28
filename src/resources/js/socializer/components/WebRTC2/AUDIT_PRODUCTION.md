# WebRTC2 — Audit production

> Audit effectué le 28 mai 2026. Périmètre : code du module WebRTC2 en l'état,
> **sans** prendre en compte les améliorations pérennisation long terme listées
> dans [TODOLIST.md](TODOLIST.md).

---

## Question posée

**En l'état actuel du code, peut-on basculer WebRTC2 en production ?**

WebRTC2 est la réécriture du module historique `/WebRTC/` (PeerJS + Vue 3 composables, topologies mesh & star). L'audit sécurité a été clôturé ([SECURITY_AUDIT.md](SECURITY_AUDIT.md)) — toutes les failles critiques (usurpation, DoS, anti-injection métadata) sont corrigées et couvertes par des tests dédiés.

Ce document tranche : **OK pour prod** / **OK avec réserves** / **Pas prêt**, avec la liste précise des trous bloquants.

---

## Méthode

Trois axes audités en parallèle, chaque finding vérifié par lecture directe du code (les agents d'exploration ont produit ~25 findings runtime, plusieurs ont été **invalidés** après lecture — voir §7) :

1. **Robustesse runtime** : race conditions, fuites, états bloqués, cleanup
2. **Couverture des tests** : qualité, scénarios manquants, infra CI
3. **Maturité opérationnelle** : intégration, signaling backend, logger, gestion erreurs navigateur

---

## 1. Sécurité — ✅ Solide

Toutes les failles connues sont corrigées et couvertes par tests dédiés (`__tests__/usePeerTransport.incomingAuth.test.js`, `forwardStar.test.js`, `mesh.test.js`, `utils/sanitizeMetadata.test.js`, `utils/payloadSize.test.js`) :

- Anti-usurpation `envelope.from` (hub résout l'identité PeerJS réelle, ignore le champ déclaratif)
- Rate-limit hub sur peerId réel (`_isHubRateLimited`, défaut 20 msg/s)
- Garde taille payload `MAX_PAYLOAD_BYTES = 64 KB` à l'émission ET à la réception (défense en profondeur, utilitaire mutualisé `Composables/utils/payloadSize.js`)
- Filtrage `envelope.to` ∩ `usersInRoom` + validation slug
- Auth connexion entrante double chemin : (a) membres `usersInRoom` (présence Reverb) OU (b) mapping `peerStore.getRemotePeerId(from)` qui correspond strictement au `conn.peer` réel (appel direct 1-à-1 vérifié)
- Sanitisation `conn.metadata.type` (whitelist `VALID_CONNECTION_TYPES`, anti-pollution logs)
- Backend Laravel : `fromUserSlug` forcé à `Auth::user()->slug` sur tous les endpoints signaling
- Modèle de confiance documenté ([README.md § Modèle de confiance](README.md))

**Verdict sécurité : prêt prod.**

---

## 2. Architecture — ✅ Solide

- Séparation propre des couches : Feature (`useMediaBroadcast`) → Orchestrator (`usePeerOrchestrator`) → sous-modules (`usePeerCore` / `usePeerMedia` / `usePeerConnections` / `usePeerTransport`) → utils
- Pas d'imports croisés entre sous-modules — tout passe par le `context` partagé (`createPeerContext`)
- Conventions à respecter documentées ([CONVENTIONS.md](CONVENTIONS.md))
- Bornes/limites centralisées dans [webrtc2.config.js](webrtc2.config.js) : `MAX_PEERS_PER_ROOM`, `MAX_RETRY_ATTEMPTS`, `MAX_REMOTE_STREAMS`, `STREAM_STALE_MS`, `HUB_MAX_MESSAGES_PER_WINDOW`, etc.
- Machine d'état appels formalisée (`Composables/utils/useCallStateMachine.js`) — couverte à 100 %
- Retry exponentiel unifié (`Composables/utils/usePeerRetry.js`) — couvert à 100 %
- Cleanup déterministe : watchers/timers tracés et annulés, `contextRegistry` en last-write-wins volontaire avec garde anti-écrasement

**Verdict architecture : prêt prod.**

---

## 3. Couverture des tests — ⚠️ Lacunaire mais ciblée

État chiffré ([__tests__/TESTS_PLAN.md](__tests__/TESTS_PLAN.md)) :

| Module | Tests | Verdict |
|---|---|---|
| `useCallStateMachine` | 35 | ✅ complet |
| `usePeerRetry` | 15 | ✅ complet |
| `payloadSize` | 8 | ✅ complet |
| `sanitizeMetadata` | 6 | ✅ complet |
| `usePeerTransport` (sécurité) | 22 | ✅ chemins sensibles couverts |
| `usePeerCore` | ~20 | ⚠️ signaling watcher + `onUnmounted` manquent |
| `usePeerConnections` | **0** | ❌ Tâche 2 du plan, non démarrée |
| `usePeerMedia` | **0** | ❌ Tâche 3 du plan, non démarrée |
| `createPeerContext` | **0** | ❌ Tâche 5 du plan, non démarrée |
| `usePeerOrchestrator` | **0** | ❌ Tâche 6 du plan, non démarrée |
| `useMediaBroadcast` | **0** | ❌ Tâche 7 du plan, non démarrée |

**Pas de CI** (aucun `.github/workflows` à la racine projet) → les ~88 tests existants ne s'exécutent qu'en local, à la main.

**Pas d'e2e** (Playwright/Cypress absents) → aucune validation deux-clients-réels.

Scénarios critiques sans test :

- Reconnexion après disconnect PeerJS (`MAX_RECONNECT_ATTEMPTS` + backoff non validé)
- `getUserMedia` refusé / device absent / contraintes incompatibles
- ICE failed / `peer-unavailable` → recovery
- Singleton Peer ref-counting + `PEER_DESTROY_DELAY_MS` (annulation si remontée avant expiration)
- Isolation `contextRegistry` last-write-wins (logique non triviale, déjà source d'un bug — cf. SECURITY_AUDIT.md)
- `getRoomUsersDiff` mutex sous concurrence (TOCTOU sur `usersInRoom`)

**Verdict tests : insuffisant pour partir en prod sans inspection manuelle approfondie.**

---

## 4. Intégration dans l'app — ❌ Non branchée

**Découverte clef :** WebRTC2 n'est consommé par AUCUN composant applicatif. Recherche sur `useMediaBroadcast`, `MediaBroadcastProvider`, `usePeerOrchestrator` dans tout le projet :

- `AudioRoom/AudioComponent.vue` → importe `~socializer/components/WebRTC/widgets/MediaBroadcastProvider.vue` (**WebRTC legacy**)
- `System/Notifications.vue` → `useMediaBroadcast()` depuis **WebRTC legacy**
- Seuls les `Exemples/*.vue` internes à `WebRTC2/` consomment le nouveau module

Conséquence : la question « WebRTC2 prêt pour la prod ? » est en réalité **« la bascule WebRTC → WebRTC2 est-elle prête à se faire ? »**. Aucune charge réelle n'a tourné sur WebRTC2 en environnement multi-utilisateurs.

**Verdict intégration : la bascule reste à faire, sur un module non éprouvé en charge réelle.**

---

## 5. Gestion des erreurs navigateur — ❌ Bloquant

Dans [Composables/usePeerMedia.js](Composables/usePeerMedia.js) lignes 32-72 :
`startCurrentStream`, `startAudioStream`, `startScreenCapture` font tous
`await navigator.mediaDevices.getUserMedia(...)` ou `getDisplayMedia(...)`
**sans `try/catch`**.

Vérification de l'appelant : `useMediaBroadcast.js` se contente de faire
`startWebcamStream()` (sans `await`, sans `.catch`). Le `try/catch` ligne 136-143
couvre uniquement `syncUsersConnections` dans `watchUsers`, pas les démarrages
de stream.

Scénarios qui plantent silencieusement aujourd'hui :

- `NotAllowedError` (utilisateur refuse la permission caméra/micro) → unhandled rejection
- `NotFoundError` (pas de caméra/micro disponible)
- `NotReadableError` (matériel pris par un autre logiciel)
- `SecurityError` (page servie en http au lieu de https)
- `OverconstrainedError` (contraintes vidéo/audio incompatibles)
- Navigateur sans support `getDisplayMedia` (Safari iOS, certains in-app browsers)

Aucun message UX, aucun fallback, aucun retour de la FSM appel vers `IDLE`.
L'utilisateur voit simplement « rien ne se passe ».

**Verdict gestion erreurs navigateur : BLOQUANT prod.**

---

## 6. Observabilité opérationnelle — ⚠️ Préoccupant

- ~50 `console.log/warn/error` dispersés dans les composables, aucun logger structuré (déjà listé en TODOLIST P2, non bloquant en soi mais douloureux)
- Aucun état debug exposé pour inspecter en runtime : connexions actives, retries en cours, contextes enregistrés, `usersInRoom`, `currentCallUsers`
- En cas d'incident prod (« mon appel ne s'établit pas »), l'opérateur n'a aucun moyen de diagnostiquer côté client à part demander un screenshot de la console

Pas bloquant **strictement** (l'app peut tourner), mais sera très douloureux dès le premier incident en prod.

---

## 7. Findings runtime — vérification critique

Les agents d'exploration ont remonté plusieurs « BLOQUANT » et « MAJEUR ». Après lecture directe du code, la grande majorité sont **invalidés** :

| Finding remonté | Verdict après lecture |
|---|---|
| `_diffLock` reste sur promesse rejetée → deadlock | ❌ **Faux**. `usePeerConnections.js:53-55` — `_diffLock = current.catch(() => {})` absorbe explicitement le rejet, jamais bloqué |
| `isShuttingDown` bloque après stop/start rapide | ❌ **Faux**. `usePeerOrchestrator.js:351-366` — séquence synchrone, JS mono-thread, `retryManager.clearAll()` appelé en premier |
| `_peerInitPromise` race entre `.finally` et nouveau `setLocalPeer` | ❌ **Faux**. JS mono-thread, `.finally` s'exécute avant tout autre `setLocalPeer` planifié sur le même tick |
| `waitForLocalStream` watch sur `targetCtx` détruit → crash | ⚠️ **Mineur**. `usePeerTransport.js:550-568` — le watch optionnel-chaîné `targetCtx.media?.currentStream` ne crash pas, le `setTimeout` finit par résoudre `null` |
| `remoteStreamsMap.forEach` + `delete` concurrent | ⚠️ **Mineur**. JS mono-thread, pas d'autre tick possible pendant la boucle synchrone |
| `streamCleanupListeners` Map sans borne | ⚠️ Légitime mais effet limité — TODOLIST P2 (pérennisation long terme) |
| Auth client `/ask-to-peer-id` non rate-limitée côté émission | ⚠️ Légitime — déjà listé en TODOLIST P2 (non-bloquant, route authentifiée) |

**Conclusion §7 : aucun BLOQUANT runtime confirmé.** Le code est plus robuste qu'il n'y paraît au survol — les conventions cleanup tiennent.

---

## Verdict global

> **❌ Pas prêt pour la production en l'état**, mais **proche** : 1 trou bloquant fonctionnel + 1 trou bloquant méthodologique.

### Sont OK

Sécurité · architecture · cleanup déterministe · sous-modules unitairement testés (FSM, retry, payloads, sanitisation, auth entrante, forward star, mesh).

### Bloquent la mise en prod

1. **Gestion des erreurs `getUserMedia` / `getDisplayMedia` absente** → toute prise vidéo qui échoue laisse l'UI dans un état muet
2. **Pas de couverture e2e ni d'usage applicatif réel** → la bascule WebRTC → WebRTC2 doit se faire sur un module dont aucune room réelle n'a stressé le code

### Ne bloquent pas mais auront un coût opérationnel

3. Logger non structuré + pas d'état debug exposé → diagnostic d'incident pénible
4. 5 modules sur 8 sans tests unitaires (orchestrator, connections, media, context, broadcast) → toute régression future passe inaperçue jusqu'à un report utilisateur
5. Aucune CI → les ~88 tests existants ne protègent rien tant qu'ils ne tournent pas à chaque push

---

## Trous bloquants à combler avant la bascule prod

Par ordre d'effort / impact :

1. **[S, 0.5 j] Try/catch + messages UX sur `get*Media`** dans `Composables/usePeerMedia.js` (ou dans l'appelant `useMediaBroadcast`). Différencier `NotAllowedError`, `NotFoundError`, `NotReadableError`, `SecurityError`, `OverconstrainedError`. UI doit afficher un message clair et remettre la FSM appel dans `IDLE`.

2. **[M, 1 j] Brancher WebRTC2 sur 1 ou 2 vues réelles** (cibler `AudioComponent.vue` et `Notifications.vue` qui consomment encore le legacy `/WebRTC/`). Faire tourner **au moins une session multi-utilisateurs réelle** (visio + chat data + screen-share) en pré-prod avant le go.

3. **[M, 1-2 j] Tests d'intégration minimum** sur les 3 modules les plus risqués sans tests :
   - `usePeerOrchestrator` (flux d'appel complet via `useMediaBroadcast`)
   - `usePeerConnections` (mutex `getRoomUsersDiff`, `connectToPeer` avec `MAX_PEERS_PER_ROOM`)
   - `createPeerContext` (isolation entre deux contextes simultanés, `contextRegistry` last-write-wins)

   Pas besoin de couvrir tout le plan, juste les chemins critiques.

4. **[S, 0.25 j] Configurer une CI minimale** (`.github/workflows/test.yml`) qui exécute `npm run test:run` sur push et PR. Empêche la régression silencieuse des 88 tests existants.

5. **[Optionnel — recommandé, S, 0.5 j] Logger centralisé minimal** + une `getDebugState()` readonly sur `usePeerOrchestrator` pour exposer `usersInRoom`, `inFlightConnections`, `retries`, `currentCallUsers`. Indispensable au premier incident prod, pas avant.

**Effort total estimé pour atteindre « prêt prod » : 3 à 5 jours.**

---

## Vérification finale (avant go-live)

Pour valider que la bascule est prête :

1. `npm run test:run` depuis la racine projet → tous les tests existants passent
2. Brancher `useMediaBroadcast` (WebRTC2) dans une vue de pré-prod
3. **Refuser la permission caméra** dans le navigateur → vérifier qu'un message UX clair s'affiche et que la FSM appel revient à `IDLE`
4. Faire un **appel 2 navigateurs** (audio + vidéo + screen-share + chat data) > 5 min — vérifier qu'aucun handler résiduel ne reste après `cleanup()` (`window.performance.memory` stable, aucun track `live` dans `getTracks()` après stop)
5. **Tuer brutalement un onglet** pendant un appel → l'autre côté doit voir le peer disparaître proprement (test du `peer-unavailable` recovery)
6. **Stress hub star** : envoyer > 20 messages/s depuis un client → vérifier que le rate-limit hub déclenche et que la mémoire `_hubRateWindows` reste bornée

---

*Voir aussi :*
- [README.md](README.md) — vue d'ensemble + modèle de confiance
- [CONVENTIONS.md](CONVENTIONS.md) — conventions à respecter
- [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — journal des correctifs sécurité
- [TODOLIST.md](TODOLIST.md) — améliorations long terme (hors périmètre de cet audit)
- [__tests__/TESTS_PLAN.md](__tests__/TESTS_PLAN.md) — plan complet des tests à venir
