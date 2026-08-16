# Chantiers en cours

> **Ce dossier n'est pas de la documentation.** Il porte le suivi de travail : todo, audits,
> plans de tests, notes de chantier. Cases à cocher, chiffres et dates y sont les bienvenus.
> Le définitif vit dans [`docs/`](../docs/INDEX.md) — la règle de partage est dans
> [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md).

Rien ici n'est à charger par défaut. On l'ouvre quand on reprend le chantier concerné.

---

| Fichier | État | En une phrase |
|---|---|---|
| [webrtc2-securite-2026-08-14.md](webrtc2-securite-2026-08-14.md) | 🟠 démarré, **lots A, B et C terminés** — A1+A2+A3, B0+B1+B2+B3 (15/08), C3+C1 (15/08), C4, C2, **C5 puis E5 (16/08)** ; **régressions corrigées** (B2-fix, puis B2-fix-2 qui portait la vraie cause). L'usurpation intra-room est **fermée** côté serveur, le bouton d'appel ne propose plus un appel qui partirait en 403, et le refus dit pourquoi au lieu d'afficher un toast vide. **E4 ajoutée le 16/08** (`canJoinServer` dérive avec les groupes), **E6 le 16/08** en cadrant E5 (périmètre estarter : le même toast se répète, et un 429 ne dit rien). Restent D (TURN), E1/E2/E3-`getUsersList`/E4/E6 et F (doc). | 16 tâches en 6 lots pour fermer le sens **sortant** des connexions, durcir l'entrant, sécuriser les 5 routes backend et sortir les credentials TURN du bundle. Côté client, le prédicat unique `utils/isAuthorizedPeer.js` garde les deux sorties du contexte : l'ouverture de connexion (A2) et la livraison du peerId (B2). Deux leçons durables : un `usersInRoom` vide n'autorise **aucune** conclusion (les gardes du chemin présence attendent `presenceSynced` avant de refuser, jamais avant d'admettre), et « connexion ouverte » ≠ « connexion établie » — les confondre arrêtait le moteur de retry une seconde après un appel que personne n'avait répondu. B0 a mesuré que le mapping peerId est **absent** à l'admission sur tout le chemin présence : B1 n'a donc pas fusionné ses deux chemins, il a rendu la règle anti-usurpation inconditionnelle et **tracé** l'admission non corroborée. Côté backend, C1 a livré la leçon symétrique : **les 5 routes n'ont pas la même cadence légitime** (14 requêtes dans un tick au join contre ~9 en 55 s pour une invitation), donc deux buckets, pas un. C4 : sur un chemin de signalisation, **la sévérité est le risque, pas la permissivité** — trois nullables qui ressemblent à des oublis sont les trois chemins que la stricte aurait cassés. C2 a fermé le garde autoritatif (« même groupe MariaDB OU follow réciproque ») en invalidant la lettre de son propre plan : `canJoinRoom`/`canJoinServer` **ne sont pas des prédicats d'appartenance** (sur une room publique ils répondent `true` à tout le monde), l'arête `user→room` n'existe que pour le créateur, et la copie graphe des groupes **dérive** — le listener qui devrait la synchroniser est entièrement commenté. D'où la leçon la plus réutilisable du lot : **le graphe est un réplica, pas une source de vérité** ; un garde qui l'interroge pour une donnée dont MySQL est le maître refuse des accès légitimes, silencieusement. C5 a ajouté le pendant côté interface : **tout garde posé sur une action proposée par l'UI doit être lisible par cette UI**, sinon le refus devient un bouton qui ne fait rien — et le verdict exposé reste de l'UX, jamais un contrôle. E5 a poussé la même idée d'un cran : **le corps d'une réponse de refus est du texte affiché**, pas seulement une donnée de protocole — un garde n'est fini que lorsqu'on a suivi son refus jusqu'au pixel. Sa contre-épreuve a trouvé le bonus : **`json_encode` échappe les `/`**, donc l'assertion de non-fuite de chemin de C3 ne pouvait plus jamais matcher sur un corps JSON. |
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
