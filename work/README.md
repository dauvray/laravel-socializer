# Chantiers en cours

> **Ce dossier n'est pas de la documentation.** Il porte le suivi de travail : todo, audits,
> plans de tests, notes de chantier. Cases à cocher, chiffres et dates y sont les bienvenus.
> Le définitif vit dans [`docs/`](../docs/INDEX.md) — la règle de partage est dans
> [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md).

Rien ici n'est à charger par défaut. On l'ouvre quand on reprend le chantier concerné.

---

| Fichier | État | En une phrase |
|---|---|---|
| [webrtc2-securite-2026-08-14.md](webrtc2-securite-2026-08-14.md) | 🔴 **le plus urgent**, démarré — **lots A et B terminés** (A1+A2+A3, B0+B1+B2, 15/08), **régressions corrigées** (B2-fix, puis B2-fix-2 qui portait la vraie cause) ; **le lot C (backend) est en cours** — **C3 et C1 faits le 15/08, C4 le 16/08**, la prochaine est **C2**, seule fermeture possible de l'usurpation intra-room. **B3 ajoutée et terminée le 15/08** (une acceptation d'appel non sollicitée s'inscrivait dans `authorizedCallPeers` avant la garde de la machine d'état, ce qui **contournait A2 et B2**). **C5** ajoutée : aligner le bouton d'appel sur la règle de C2. L'arbitrage produit de C2 est **tranché** : « follow mutuel OU contexte partagé ». | 15 tâches en 6 lots pour fermer le sens **sortant** des connexions, durcir l'entrant, sécuriser les 5 routes backend et sortir les credentials TURN du bundle. Côté client, le prédicat unique `utils/isAuthorizedPeer.js` garde désormais les deux sorties du contexte : l'ouverture de connexion (A2) et la livraison du peerId (B2). Deux leçons durables : un `usersInRoom` vide n'autorise **aucune** conclusion (les gardes du chemin présence attendent `presenceSynced` avant de refuser, jamais avant d'admettre), et « connexion ouverte » ≠ « connexion établie » — les confondre arrêtait le moteur de retry une seconde après un appel que personne n'avait répondu. B0 a mesuré que le mapping peerId est **absent** à l'admission sur tout le chemin présence : B1 n'a donc pas fusionné ses deux chemins, il a rendu la règle anti-usurpation inconditionnelle (ce qui a fermé un cas perméable du chemin appel direct) et **tracé** l'admission non corroborée. À retenir avant de conclure : la faille d'usurpation intra-room **reste ouverte** — le cas nominal et l'attaque ont la même signature locale, seul le backend peut trancher. Côté backend, C1 a livré la leçon symétrique : **les 5 routes de signalisation n'ont pas la même cadence légitime** (14 requêtes dans un tick au join contre ~9 en 55 s pour une invitation d'appel), donc un plafond unique ne peut pas à la fois laisser passer le join et fermer le spam d'invitations — deux buckets, pas un. C4 a ajouté la sienne : sur un chemin de signalisation, **la sévérité est le risque, pas la permissivité** — chaque règle est calquée sur une émission relue dans le client, et trois nullables qui ressemblent à des oublis (`connectionType`, `options.action` côté réponse, `options.peerId`) sont en fait les trois chemins que la stricte aurait cassés. Reste la version autoritative du garde (C2). |
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
