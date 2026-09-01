# Chantiers en cours

> **Ce dossier n'est pas de la documentation.** Il porte le suivi de travail : todo, audits,
> plans de tests, notes de chantier. Cases à cocher, chiffres et dates y sont les bienvenus.
> Le définitif vit dans [`docs/`](../docs/INDEX.md) — la règle de partage et le geste de clôture
> d'un chantier sont dans [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md).

Rien ici n'est à charger par défaut. On l'ouvre quand on reprend le chantier concerné.

**Chaque ligne du tableau dit ce qu'il faut pour DÉCIDER d'ouvrir le fichier, et rien de plus.**
Le détail est dans le fichier ; le récit est dans `git log`.

---

## Ordre de priorité

Aucun chantier ne passe devant les autres. L'ordre par défaut, tant que rien n'est demandé
explicitement :

1. **Le module WebRTC2 au fil de l'eau — [webrtc2-todo.md](webrtc2-todo.md).**
   **Aucun 🔴 ouvert depuis le 31/08** : « accepter un appel vocal entrant ne fait rien » est fermé
   (lot B1), et le second défaut des alertes — le timer d'auto-refus qui survivait au démontage —
   l'est aussi (lot B2, le même jour). Le 🟠 qui les remplace vient du cadrage de B2 et est d'une
   autre nature : **une seconde invitation PATCHE l'alerte vivante au lieu de la remonter**, donc le
   second appelant hérite du reliquat de minuteur du premier et se fait refuser à sa place. B2 ne le
   referme pas et en est le préalable — c'est le lot B5.

   ✅ **Le plan de tests est clos** : les trois étages sont couverts, y compris
   l'étage de présentation, et son fichier de suivi a été supprimé après remontée de son durable
   dans [`docs/architecture/tests.md`](../docs/architecture/tests.md) (la méthode) et
   [`docs/modules/webrtc2/tests.md`](../docs/modules/webrtc2/tests.md) (le harnais).

   **Reste ouvert, aucun bloquant** : un 🟠 de couverture — aucun scénario n'exerce la topologie
   star, donc « hub absent → hub présent » n'est épinglé à aucun étage —, la bascule
   `SOCIALIZER_PEER_ATTESTATION_ENFORCE`, qui est un geste de déploiement et non du code, et des
   items de pérennisation 🟢/🟠 (fidélité du mock, observabilité, robustesse).

   ⚠️ **Rien de tout cela n'est livré** : le paquet n'a **aucun tag** et le `composer.lock` de
   l'hôte épingle un commit du 29/05. C'est le 🔴 restant de
   [`work/deploiement-tiers.md`](../../../../work/deploiement-tiers.md) du projet hôte.

2. [doc-rustines.md](doc-rustines.md) — le volet de ce paquet dans le chantier transverse. Le lot 0
   est terminé, et le lot 1 est **entamé** : `webrtc2Events.js` supprimé (31/08), le filet du lot A1
   posé (31/08), **B1 fermé** puis **B2 fermé le 31/08** — le minuteur d'auto-refus est annulé sur le
   chemin commun aux trois sorties, `pickedUp` supprimé en code mort, et le troisième harnais existe :
   `AlertComponent.timers.test.js`, **premier montage de composant Vue sous horloge factice du
   paquet**, 9 cas dont 5 rouges d'abord. **Puis le lot C fermé le 31/08** : les deux alertes d'appel
   vivent dans `WebRTC2/Widgets/UI/Alerts/`, la v1 perd son cinquième appelant et deux de ses treize
   fichiers. La preuve annoncée a tenu à la ligne près — deux renommages, une paire d'imports, **zéro
   fichier de test touché**.

   **Puis le lot A clos le 01/09** par A2 et A3. A2 était une lecture : la liste de présence est
   **réaffectée** par `useReverbChannel`, jamais mutée en place — et la question ne se posait pas
   appelant par appelant, les trois modules data ne possèdent pas leur liste, ils la reçoivent en
   prop d'un `<router-view>` unique. **Donc rien à adapter au lot D**, ni chez l'appelant ni chez le
   provider. A3 en a tiré le filet qui manquait : le contrat « le fournisseur réaffecte » n'était
   épinglé à **aucun** bout, et un `push` dans le composable arrêtait la présence de tous les
   providers en rougissant 0 cas. Il est désormais tenu aux deux bouts.
   **Puis D0 le 01/09** : la correspondance v1 → v2 est écrite une fois, dans
   [webrtc-data-v1-v2.md](webrtc-data-v1-v2.md) — et le contrat v2 qu'elle a mis au jour est allé
   dans la doc du module, où il manquait. Elle a retourné **deux** affirmations fausses, dont une
   « bonne nouvelle » qui promettait qu'il n'y avait rien à faire.
   **Puis D1 le 01/09** : le Whiteboard est migré, **un seul fichier de code**, et les appelants v1
   vivants passent de quatre à **trois**. Suite JS inchangée (85 fichiers / 1501 cas) et
   `npm run build` vert ; **la vérification à deux navigateurs reste ouverte**, seule case décochée du
   lot. **Le lot a corrigé la recette de D0 sur deux points, et les deux servent D2 et D3** :
   `onConnectionOpen` tire dans les **deux sens** en v2 alors que le `callbackConnection` de la v1 ne
   tirait que sur l'entrant — donc « préserver l'effet de bord » ne peut pas se faire par substitution
   (sans garde, chaque pair renvoyait sa scène deux fois ; chez D2, l'iframe recevrait une annonce de
   pair **me désignant moi**) — et le plafond de 64 Ko de `sendData` est une **régression** de la v2
   sur la v1, qui n'avait aucune limite. La scène Excalidraw est le seul payload du paquet dont la
   taille est pilotée par l'utilisateur : borne **assumée** à D1, avec sa tâche ouverte au lot 5.
   **La tâche suivante est D2**, Application — le plus dense des trois.
   **B5 reste ouvert en parallèle**,
   sans dépendance, mais demande de trancher une question produit avant d'écrire la `key`. Le reste de la migration des appelants de WebRTC v1 est la tâche la plus
   rentable du paquet en volume de doc — **sept lots A→G**. Le cadrage a trouvé un **sixième**
   consommateur du code v1 que le recompte ratait, `Server/Server.vue` (par le store
   `stores/peers.js`, jamais par `WebRTC/`) : la commande de recompte de la doc du module demande
   désormais **deux** greps, corrigée au lot C. L'ordre des lots est fixé par
   [le `work/` du projet hôte](../../../../work/README.md).

   ⚠️ **Ce que les lots C, A2 et A3 ont appris, et que le gabarit des trois volets n'annonçait
   pas** : une tâche qui ne change **aucun** comportement — voire qui n'écrit **aucun** code — peut
   avoir le volet doc le plus lourd. C a périmé trois *décomptes* au moment même où il devenait vert
   (cinq appelants → quatre, treize fichiers → onze, un sous-dossier de plus) ; A3 a périmé deux
   *mesures de contrôle à 0*, dont une dans `docs/`, à la seconde où le filet qu'elles réclamaient a
   été posé. Un décompte, une mesure : ce sont des annotations comme les autres. À chercher dès
   qu'un lot pose un test ou déplace un fichier. **D1 en a périmé cinq de plus** — dont trois dans
   `doc-rustines.md` lui-même, le fichier qui porte la doctrine.

   ⚠️ **Ce que D1 ajoute en propre : une recette écrite par LECTURE n'est vérifiée que par le premier
   lot qui l'exécute.** D0 avait lu tout le code du canal data ; il a fallu *écrire* D1 pour trouver
   ses deux trous — un fait qu'elle énonçait sans en tirer la conséquence, et un fait qu'elle n'avait
   pas cherché parce qu'elle comparait deux **contrats** et non deux **implémentations**. Corollaire
   pour D2, D3 et E : **la recette est un point de départ, pas une autorité** — sa correction est un
   livrable de chaque lot qui s'en sert.

   Ce que le troisième harnais a coûté, et qui vaut pour le prochain composant testé sous horloge
   factice : **deux minuteurs parasites** que `vi.getTimerCount()` compte sans qu'ils appartiennent
   au composant — `defineAsyncComponent` arme un `setTimeout` de 200 ms **même sans option** (son
   `delay` par défaut, jamais annulé), et le renderer de Vue en arme un de 3 s à sa création, une
   fois par fichier. Un comptage absolu est donc faux ; le détail est dans le docblock du fichier.

> ⏸️ **[projection-graphe-todo.md](projection-graphe-todo.md) est suspendu — au besoin seulement.**
> Ses items restants sont 🟢/🟠 et ne bloquent rien. **Ne pas le rouvrir parce qu'une lecture de code
> y ramène** : y verser un constat sans rouvrir le chantier est l'usage prévu. La raison de la
> prudence est dans son en-tête — chaque item y *paraît* petit et adjacent au précédent, et c'est
> exactement comme la dérive s'est produite.

---

## Hors chantier — la seule garantie qui manque au paquet

- [ ] 🟠 **Aucune CI : le seul filet est un hook local** `[S]` — relevé le 29/08/2026 au point
  d'étape QA. Il n'y a pas de fichier de chantier pour ça et il n'en faut pas ; l'item vit ici.

  Le hook [`hooks/pre-push`](../hooks/pre-push) est bon et il est actif sur cette machine
  (`core.hooksPath=hooks`, vérifié). Mais **deux propriétés le rendent insuffisant comme garantie** :
  c'est un `git config` **par clone** — un clone neuf n'a rien — et il **dégrade en autorisant le
  push** quand les dépendances manquent, ce qui est le bon comportement pour un hook et le mauvais
  pour une garantie. Rien n'empêche donc structurellement qu'une suite rouge parte sur `origin`.

  Ce que ça coûterait de poser : rejouer les deux suites, qui ne tournent pas au même endroit — PHP
  dans le paquet (Testbench, aucun serveur, `composer install && vendor/bin/phpunit`), **JS depuis un
  hôte** puisque le paquet n'a ni `package.json` ni `node_modules`. **C'est là qu'est le vrai coût**
  : la CI JS doit reconstituer un hôte minimal portant `vitest.config.js` et l'alias `~socializer`,
  ou vendre le paquet dans un hôte de test. À dimensionner avant de s'y mettre.

  ℹ️ Sans objet tant que le développement se fait à une seule main sur `refacto-webrtc` — le hook
  suffit alors. Ça cesse d'être vrai **le jour où quelqu'un d'autre clone**, ou le jour où un projet
  consommateur épingle un tag ; c'est à ce moment-là que cet item devient bloquant, pas avant.

---

| Fichier | État | En une phrase |
|---|---|---|
| [webrtc2-todo.md](webrtc2-todo.md) | ouvert, **aucun 🔴** | Le suivi vivant du module. **Un 🟠 sur les alertes d'appel** : une seconde invitation reçue sans avoir répondu à la première PATCHE l'alerte vivante au lieu de la remonter, donc le second appelant hérite du reliquat de minuteur du premier et se fait refuser à sa place — il se traite dans le lot B5 de [doc-rustines.md](doc-rustines.md), pas ici. **Un 🟠 de couverture** — aucun scénario n'exerce la topologie star, donc « hub absent → hub présent » n'est épinglé à aucun étage — et **un 🟠 de déploiement**, la bascule `SOCIALIZER_PEER_ATTESTATION_ENFORCE`, dont la procédure impose de lire **deux** indicateurs et jamais un seul. Le reste est de la pérennisation 🟢/🟠 : fidélité du mock PeerJS, observabilité, robustesse, et ce que la couverture des boutons d'appel a ouvert. Les items terminés y sont élagués — leur rationale vit dans [`docs/`](../docs/modules/webrtc2/INDEX.md), leur récit dans `git log`. |
| [doc-rustines.md](doc-rustines.md) | 🟠 démarré — **lot 0 terminé, lot 1 entamé** | rendre la doc exempte d'annotations qui compensent un défaut du code. `webrtc2Events.js` est supprimé (31/08, sortie B), le filet du lot A1 est posé, **B1, B2 et C sont fermés (31/08)** — B2 en sortie A + sortie B, avec le troisième harnais (faux timers, 9 cas dont 5 rouges) et **deux bornes de durée retirées des docblocks de A1 avec leur cause** ; C a sorti les deux alertes d'appel de l'arbre v1 sans toucher une ligne de test. Le cadrage de B2 a ouvert **B5**, la face vive de la même famille. **Le lot A est clos (01/09)** : A2 a établi que la liste de présence est *réaffectée* et non mutée en place — donc rien à adapter au lot D —, et A3 a posé le filet qui manquait sur ce contrat, jusque-là épinglé à aucun bout. **Puis D0 (01/09)** : la traduction v1 → v2 est écrite une fois — [webrtc-data-v1-v2.md](webrtc-data-v1-v2.md) pour le delta, `docs/modules/webrtc2/api.md` pour le contrat v2 qui n'y était pas — et elle a retourné **deux** affirmations fausses, dont la « bonne nouvelle » qui promettait que les `JSON.parse` des trois appelants survivaient. **Puis D1 (01/09)** : le Whiteboard est migré en un seul fichier de code, la suite JS est inchangée (85 fichiers / 1501 cas) et le build vert — **sa vérif à deux navigateurs reste ouverte**. Il a corrigé la recette de D0 sur **deux** points valables pour D2 et D3 : `onConnectionOpen` tire dans les **deux sens** (donc « préserver l'effet de bord » n'est pas une substitution — chez D2, l'iframe recevrait une annonce de pair **me désignant moi**), et le plafond de 64 Ko de `sendData` est une **régression** sur la v1 qui n'en avait aucun, assumée avec sa tâche ouverte au lot 5. **La suite est D2.** **Reste au lot 1** : migrer les **trois** composants vivants qui importent encore la v1 WebRTC — ce qui retire l'annotation de **sept** fichiers de doc, dont le piège n°1 du `CLAUDE.md` et une ligne du `CLAUDE.md` de tout projet hôte — puis vider les cinq poches mortes. **Découpé en sept lots A→G le 31/08** : le filet d'abord, le correctif vocal ensuite, le déplacement des alertes, les trois modules data un par un, AudioRoom, la suppression, la doc. Trois faits du cadrage : le provider data v2 existe déjà (rien à écrire), le contrat de callback n'est pas mappable 1 pour 1 (chaque appelant se réécrit), et il y a un **sixième** consommateur hors du recompte — d'où les **deux** greps de la commande corrigée au lot C. |
| [webrtc-data-v1-v2.md](webrtc-data-v1-v2.md) | **recette, éprouvée une fois (D1)** | la traduction du canal data v1 → v2, écrite une fois (lot D0). On l'ouvre en migrant Application ou ClassRoom, et pour rien d'autre — Whiteboard est fait. Elle **pointe** `docs/modules/webrtc2/api.md` pour tout ce qui concerne la v2 et ne porte que le delta : la bascule de balise, les **cinq** écarts d'émission — dont **la sérialisation, que le cadrage donnait à tort pour un non-sujet**, et le plafond de 64 Ko, cinquième écart trouvé en exécutant D1 — et ce que chaque module a en propre. **D1 l'a corrigée sur deux points** : le double sens d'`onConnectionOpen` et ce cinquième écart ; son en-tête le dit. Un point produit reste ouvert et appartient à D2 : `exclude` n'a aucun équivalent v2. **Ce fichier part avec `components/WebRTC/`**, au lot F/G. |
| [projection-graphe-todo.md](projection-graphe-todo.md) | ⏸️ **suspendu — au besoin seulement** | suites du correctif « un utilisateur = un mur + un feed ». Rien n'y bloque ; deux items portent une exigence d'exploitation (sauvegarder le space NebulaGraph, que rien ne reconstruira). |
| [chat-tests-plan.md](chat-tests-plan.md) | **non démarré** | plan de tests du Chat en 5 couches ; un seul fichier de test existe. Décision en attente sur les helpers (`mockEcho`, `mockRoute`, `seedChatStore`) : dédiés à Chat, ou promotion des helpers WebRTC2 — le fichier nomme le candidat existant et les deux fidélités qu'un partage naïf effacerait. |
| [front-todo.md](front-todo.md) | **non démarré** | deux items. Le ping d'ouverture de session part avant que pusher n'ait confirmé l'abonnement, et Reverb le rejette — l'utilisateur peut rester hors ligne deux minutes ; le correctif naïf (`subscribed(cb)`) ne part jamais sur un canal déjà confirmé. Et `isEmpty(element.store)` lève sur un commentaire de post chargé par la liste, **dans un listener Reverb donc en silence** — quatre appelants, deux étages possibles pour le correctif. |
| [sass-todo.md](sass-todo.md) | **non démarré** | de la dette de style, et seulement ça depuis que le 🔴 « vignette d'attente invisible » est parti dans le chantier WebRTC2 qui l'avait produit (fermé le 28/08, sans rien devoir à ce fichier). Restent : thème sombre cassé par des couleurs en dur, absence de `_variables.scss` propre au paquet (arbitrage A/B à trancher), URL d'image externe en prod, et les `@extend` de classes Bootstrap à migrer. |
