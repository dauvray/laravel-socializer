# Chantiers en cours

> **Ce dossier n'est pas de la documentation.** Il porte le suivi de travail : todo, audits,
> plans de tests, notes de chantier. Cases à cocher, chiffres et dates y sont les bienvenus.
> Le définitif vit dans [`docs/`](../docs/INDEX.md) — la règle de partage est dans
> [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md).

Rien ici n'est à charger par défaut. On l'ouvre quand on reprend le chantier concerné.

---

## Ordre de priorité

**Le chantier de sécurité WebRTC2 d'août 2026 est clos** (F1, 25/08/2026). Son fichier a été
supprimé : le durable est remonté dans
[`securite.md`](../docs/modules/webrtc2/securite.md),
[`architecture.md`](../docs/modules/webrtc2/architecture.md) et
[`signalisation.md`](../docs/architecture/signalisation.md), le récit est dans `git log`. La seule
borne qu'il laisse ouverte — rafraîchir le credential TURN avant son expiration, 🟡, ne bloque rien
— vit désormais dans [webrtc2-todo.md](webrtc2-todo.md).

**Aucun chantier ne passe donc plus devant les autres.** L'ordre par défaut, tant que rien n'est
demandé explicitement :

1. Le module WebRTC2 au fil de l'eau : [webrtc2-todo.md](webrtc2-todo.md),
   [webrtc2-tests-plan.md](webrtc2-tests-plan.md).
2. [doc-rustines.md](doc-rustines.md) — le volet de ce paquet dans le chantier transverse. Lot 0
   terminé ; l'ordre d'exécution des lots suivants est fixé par
   [`work/README.md` du projet hôte](../../../../work/README.md).

> ⏸️ **[projection-graphe-todo.md](projection-graphe-todo.md) est suspendu.** Il est né le 22/08 d'un
> effet de bord d'E7 — rendre les écritures de graphe bruyantes a fait remonter des défauts de
> projection — et les suivre a coûté deux jours hors du chantier sécurité. Ses trois correctifs
> (§3, §7, §1) sont livrés ; ses **huit** items restants sont 🟢/🟠, ne bloquent rien et **attendent
> un besoin réel**. Ne pas le rouvrir parce qu'une lecture de code y ramène — E4.2 y a versé §11 et
> §12 le 24/08 **sans** le rouvrir, ce qui est l'usage prévu.

---

| Fichier | État | En une phrase |
|---|---|---|
| [webrtc2-todo.md](webrtc2-todo.md) | ouvert | ~10 items de pérennisation : sémantique de `peerInitPromise`, peerId fantôme après `destroy()` précoce, renommage de `usersInRoom`, observabilité. Plus un `[L]` **gelé** — déplacer le routage star dans `usePeerTransport` — qui bloque deux tâches de tests. |
| [webrtc2-tests-plan.md](webrtc2-tests-plan.md) | ouvert, bien avancé | avancement par fichier et trous restants (`sendData` star, câblage du rate-limit hub, `contextRegistry`, `usePeerCore` partiel). Les tâches 6 et 7 sont **volontairement bloquées** par le `[L]` gelé ci-dessus. |
| [doc-rustines.md](doc-rustines.md) | 🟠 démarré — **lot 0 terminé** | ~30 tâches pour que la doc cesse de compenser des défauts du code. Les cinq entrées du lot 0 sont fermées : le `CLAUDE.md` annonçait un backend non durci que le code contredit ; `webrtc2/tests.md` annonçait une CI inexistante ; deux mappings PSR-4 fantômes déjà nettoyés ; le 18/08, « le listener de groupe est commenté » alors que **deux classes homonymes** sont abonnées au même événement — cette annotation fausse avait produit une tâche de plan entièrement fausse (E4) ; et le 21/08 les imports `@/` de `use-reverb-channel.md`, qui violaient la règle d'alias que le paquet énonce dans quatre fichiers et qu'**aucun alias hôte ne résout**. Une sixième entrée y est née dans la foulée : la même page décrit une API qui a divergé du fichier (deux exports absents de sa table de retour, `isConnected` optimiste hors présence). Vient ensuite la v1 WebRTC — déclarée morte mais **encore importée par 5 composants**, sa suppression retire des annotations dans 7 fichiers. **La clôture du chantier sécurité (F1, 25/08) a levé quatre de ses cinq collisions avec WebRTC2** et fermé trois de ses entrées (faille du chemin (a), dérive du réplica, écritures muettes), toutes passées en décision documentée : voir sa section « ordre vis-à-vis du module WebRTC2 ». |
| [projection-graphe-todo.md](projection-graphe-todo.md) | ⏸️ **suspendu le 23/08 — au besoin seulement** (§3 le 22/08, §7 et §1 le 23/08, livrés) | 6 suites au correctif « un utilisateur = un mur + un feed ». `insertVertex` retombant sur `uniqidReal()` sans `id` explicite, et le DML de peuplement existant en **deux copies** (migration `create_nebula` + `socializer:nebula-populate`, dont le déroulé prévu est « installer puis rattraper »), chaque utilisateur du dev portait 2 murs et 2 feeds — d'où « Followers : 1 » pour tout le monde, le front ôtant en dur l'auto-abonnement compté deux fois. Le vrai risque n'était pas ce compteur mais `Socializable::wall()`, qui rend `$wall[0]` sans `ORDER BY`. Le §3 est tombé dans la foulée : `ArticleDeletedListener` supprimait `"1"` au lieu de `"article1"` par une clé de config inexistante, et corriger cette clé seule n'aurait rien corrigé — la création souffrait du **défaut symétrique**, `insertVertex()` sans `id` explicite sur un modèle sans `vertexId`, donc un sommet né sous `uniqidReal()` qu'aucune suppression ne pouvait viser. D'où la leçon, remontée dans la doc : **un id dérivé n'est pas qu'une garantie d'unicité, c'est la seule adresse qu'un autre écrivain puisse recalculer** — et sa fermeture a ouvert le §7, la suppression étant désormais effective sur un *soft* delete que rien ne rejouait au `restore`. **§7 fermé le 23/08** : `ArticleRestoredListener` repose le sommet, et le corps « poser le sommet d'un article » — deux copies, une troisième en vue — vit désormais dans un trait unique, ce que le nouveau test asserte en comparant la requête **entière** de la restauration à celle de la création. `ArticleUpdated` reste sans listener, par décision datée : `identifier` ne dépend que de la classe et de l'`id`. Deux sujets en sont sortis, tous deux 🟢 : l'arête d'auteur n'est posée que par la projection batch (§8, et **personne ne lit cette arête** — l'article est en écriture seule), et `projectArticles()` n'est exercé par aucun test (§9). **§1 fermé le 23/08** : les serveurs de groupes sont projetables en console — le propriétaire est résolu depuis MySQL (le leader du groupe), l'étape est idempotente par relecture + id dérivé, elle est rentrée dans `projectAll()`, et le vid est enfin mémorisé dans `extras` (sans quoi un serveur projeté restait invisible du front et non supprimable). Deux défauts trouvés en chemin y sont corrigés : **aucune étape ne créait le sommet `group`** — `owned_by` visait un sommet sans tag, donc `isServerOwner` faux pour tout le monde —, et l'avertissement « pas testable » était faux, le seul vrai blocage étant Mongo, doublé depuis par un Eloquent sqlite. La leçon, elle, a coûté un serveur en trop sur le dev : **une requête nGQL à une colonne rend une liste plate**, la suite était verte parce que la doublure rend la forme qu'on lui script — seule la contre-épreuve sur un vrai graphe l'a vu. Le §10, ouvert dans la foulée sur les six `insertVertex` sans `id` un étage plus bas, a été **refermé le même jour par un arbitrage** : il n'y a aucune table `rooms` ni `servers`, donc **pas de maître MySQL pour les salons, les chats et les messages** — le graphe est leur source de vérité, décision écrite dans `docs/architecture/package.md` et `projection-graphe.md`. Ces sommets ne sont donc pas projetables, la question de l'id dérivé ne les concerne pas, et ce qui en découle est une exigence d'exploitation qui n'appartient pas à ce dépôt : **sauvegarder le space NebulaGraph**, puisque rien ne le reconstruira. |
| [chat-tests-plan.md](chat-tests-plan.md) | **non démarré** | plan de tests du Chat en 5 couches. Un seul fichier de test existe aujourd'hui. Une décision en attente : helpers dédiés ou partagés (`mockEcho`, `mockRoute`, `seedChatStore`). |
| [front-todo.md](front-todo.md) | **non démarré** | items front transverses, hors module. Deux : lever l'ambiguïté du nommage des directives de resize (`_horizontal` redimensionne la hauteur), et **router par `useReverbChannel` les deux whispers écrits en direct contre Echo** (`ChatComponent.vue:461`, `Feed.vue:80`, ajouté le 22/08) — ils échappent au compteur de consommateurs et ne tiennent que parce que le shell garde `me.channel` ouvert. |
| [serveur-todo.md](serveur-todo.md) | 🟠 ouvert le 21/08 — **`nb_users` fermé le 24/08** | module Serveur. Le compteur valait **toujours 1** sur un serveur privé : la clause de confidentialité de `getServer` restreignait au demandeur le membre qu'elle comptait. Fermé **sans être pris pour lui-même**, en livrant E4.2 — le défaut de comptage et le défaut d'accès étaient la même clause, et sortir la décision d'accès répare le compteur par construction (contre-épreuve nGQL : 2 au lieu de 1). L'affichage « N ont accès » n'est plus bloqué. Reste un arbitrage produit : « présent » doit-il vouloir dire *onglet ouvert* (actuel) ou *fenêtre au premier plan* ? |
| [sass-todo.md](sass-todo.md) | **non démarré** | thème sombre cassé par des couleurs en dur, absence de `_variables.scss` propre au package (arbitrage A/B à trancher), URL d'image externe en prod, et ~40 `@extend` de classes Bootstrap à migrer. |
| [webrtc-v1-notes.md](webrtc-v1-notes.md) | 🗄️ archive | notes de lecture du module WebRTC **v1**, mort. Conservées le temps de vérifier qu'aucun appelant ne subsiste. |

---

## Quand un chantier se termine

1. Remonter le durable — le pourquoi, les pièges, les deltas assumés — dans le `docs/` concerné.
2. Supprimer d'ici les cases à cocher, les décomptes et le récit chronologique : ils sont dans git.
3. Supprimer le fichier s'il ne reste rien, et retirer sa ligne de ce tableau.

C'est ce qu'a fait le chantier Chat : todolist retirée une fois terminée, seul le rationale
conservé dans [`docs/modules/chat.md`](../docs/modules/chat.md).
