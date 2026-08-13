# WebRTC2

Système de communication temps réel (data, audio, vidéo, screen-sharing) construit sur PeerJS, organisé en composables Vue 3 (`Composables/`), un bus d'événements applicatifs (`EventBus/`) et des widgets de présentation (`Widgets/`).

Topologies supportées :
- **mesh** : connexions pair-à-pair directes entre tous les membres (≤ `MAX_PEERS_PER_ROOM`, défaut 8). Utilisé pour la visio/vocal et les petits salons.
- **star** : un hub (souvent le créateur de la room ou un rôle élevé) relaie les messages data aux autres membres via `forwardStarMessage`. Utilisé pour les rooms à grand nombre de participants.

Constantes et endpoints centralisés dans [`webrtc2.config.js`](webrtc2.config.js).

## Architecture

Les composables sont empilés en couches strictes — contexte, sous-modules (core / media / connections / transport), puis `useConnectionPool` → `useCallManager` → `useStreamManager` → `useBroadcastPresence` → `useSignalingQueue` → orchestrateur. Le schéma complet et la règle qui le tient (« une couche ne reçoit jamais de callback vers une couche supérieure ») sont dans [`CONVENTIONS.md`](CONVENTIONS.md#ordre-des-couches) : à lire avant toute extraction ou tout ajout de composable.

## Modèle de confiance

WebRTC2 **n'implémente pas de chiffrement de bout en bout (E2E) applicatif**. Le transport WebRTC reste chiffré au niveau réseau (DTLS/SRTP entre pairs), mais en topologie star le hub déchiffre nécessairement les enveloppes pour les retransmettre.

### Topologie mesh

Les payloads transitent **directement** entre pairs via DTLS/SRTP. Aucun tiers applicatif ne les voit en clair. Pas de modération centralisée possible : chaque pair reçoit indépendamment.

### Topologie star

Le hub lit `envelope.payload` en clair avant retransmission. C'est un **choix d'architecture délibéré** qui rend possibles, côté hub :
- le rate-limiting par identité PeerJS vérifiée (`_isHubRateLimited`)
- la garde de taille (`MAX_PAYLOAD_BYTES`, défaut 64 Ko)
- le filtrage des destinataires (`envelope.to` ∩ `usersInRoom`)
- la **modération applicative** (ex : prof relayant des messages d'élèves, filtrage de contenu, journalisation pédagogique)

**Conséquence sécurité :** si le hub est compromis (compte usurpé, machine vérolée), il a accès à toutes les conversations data transitant par lui. Le modèle de menace par défaut suppose le hub honnête — c'est le même modèle de confiance que pour un serveur de visioconférence centralisé classique.

### Recommandations d'usage

| Cas d'usage | Topologie conseillée | Justification |
|---|---|---|
| Cours prof/élèves, room modérée | **star** (hub = modérateur) | La visibilité du hub *est* la fonctionnalité ; E2E la casserait. |
| Réunion fermée ≤ 8 participants | **mesh** | Pas de tiers applicatif, payloads jamais centralisés. |
| Échanges nécessitant la non-divulgation au serveur | **mesh uniquement** | Aucun chiffrement applicatif supplémentaire n'est fourni à ce jour. |
| Très grande room (> 8) avec messages sensibles | **non supporté** | Star n'offre pas la confidentialité hub-opaque ; mesh ne passe pas à l'échelle. |

### E2E applicatif : pourquoi pas

Un chiffrement symétrique côté client (AES-GCM via Web Crypto API) au-dessus du transport star aurait un coût d'implémentation important (rotation de clé à chaque join/leave pour la forward secrecy, échange de clés sans révélation au hub, vérification d'identité des clés, SFrame/Insertable Streams pour la visio) **et rendrait la modération par le hub impossible** — incompatible avec le cas d'usage principal (prof/élèves). La décision actuelle est de privilégier la modération et d'expliciter cette limitation plutôt que d'ajouter une couche partiellement utile.

Si un cas d'usage futur impose la confidentialité vis-à-vis du hub, la voie recommandée est de basculer la room en topologie mesh plutôt que d'introduire de l'E2E par-dessus star.

## Sécurité — autres garanties

Voir [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) pour le détail des correctifs appliqués (authentification des connexions entrantes, anti-usurpation d'identité, rate limiting, gardes de taille, sanitisation des métadonnées).
