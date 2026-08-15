# Chantiers en cours

> **Ce dossier n'est pas de la documentation.** Il porte le suivi de travail : todo, audits,
> plans de tests, notes de chantier. Cases à cocher, chiffres et dates y sont les bienvenus.
> Le définitif vit dans [`docs/`](../docs/INDEX.md) — la règle de partage est dans
> [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md).

Rien ici n'est à charger par défaut. On l'ouvre quand on reprend le chantier concerné.

---

| Fichier | État | En une phrase |
|---|---|---|
| [webrtc2-securite-2026-08-14.md](webrtc2-securite-2026-08-14.md) | 🔴 **le plus urgent**, démarré — **lot A terminé** (A1+A2+A3) et **B2 fait** (15/08) ; **B0 est la suivante** (`[S]`, sans dépendance — elle décide de la forme de B1) | 15 tâches en 6 lots pour fermer le sens **sortant** des connexions, durcir l'entrant, sécuriser les 5 routes backend et sortir les credentials TURN du bundle. Côté client, le prédicat unique `utils/isAuthorizedPeer.js` garde désormais les deux sorties du contexte : l'ouverture de connexion (A2) et la livraison du peerId (B2). Reste l'usurpation intra-room (B0→B1) et tout le **backend**, où vit la version autoritative du garde (C2). |
| [webrtc2-todo.md](webrtc2-todo.md) | ouvert | ~10 items de pérennisation : sémantique de `peerInitPromise`, peerId fantôme après `destroy()` précoce, renommage de `usersInRoom`, observabilité. Plus un `[L]` **gelé** — déplacer le routage star dans `usePeerTransport` — qui bloque deux tâches de tests. |
| [webrtc2-tests-plan.md](webrtc2-tests-plan.md) | ouvert, bien avancé | avancement par fichier et trous restants (`sendData` star, câblage du rate-limit hub, `contextRegistry`, `usePeerCore` partiel). Les tâches 6 et 7 sont **volontairement bloquées** par le `[L]` gelé ci-dessus. |
| [chat-tests-plan.md](chat-tests-plan.md) | **non démarré** | plan de tests du Chat en 5 couches. Un seul fichier de test existe aujourd'hui. Une décision en attente : helpers dédiés ou partagés (`mockEcho`, `mockRoute`, `seedChatStore`). |
| [sass-todo.md](sass-todo.md) | **non démarré** | thème sombre cassé par des couleurs en dur, absence de `_variables.scss` propre au package (arbitrage A/B à trancher), URL d'image externe en prod, et ~40 `@extend` de classes Bootstrap à migrer. |
| [webrtc-v1-notes.md](webrtc-v1-notes.md) | 🗄️ archive | notes de lecture du module WebRTC **v1**, mort. Conservées le temps de vérifier qu'aucun appelant ne subsiste. |

---

## Quand un chantier se termine

1. Remonter le durable — le pourquoi, les pièges, les deltas assumés — dans le `docs/` concerné.
2. Supprimer d'ici les cases à cocher, les décomptes et le récit chronologique : ils sont dans git.
3. Supprimer le fichier s'il ne reste rien, et retirer sa ligne de ce tableau.

C'est ce qu'a fait le chantier Chat : todolist retirée une fois terminée, seul le rationale
conservé dans [`docs/modules/chat.md`](../docs/modules/chat.md).
