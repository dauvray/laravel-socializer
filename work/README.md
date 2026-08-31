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
   🔴 **Un rouge depuis le 31/08 : accepter un appel VOCAL entrant ne fait rien** — `AudioCallAlert`
   émet un événement que personne n'écoute. Il **ne se traite pas là-bas** : c'est le lot B du
   découpage ci-dessous, parce que son test préalable et le déménagement du fichier appartiennent à
   la migration v1.

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
   est terminé, et le lot 1 est **entamé** : `webrtc2Events.js` est supprimé (31/08). **La tâche
   suivante est la migration des appelants de WebRTC v1**, la plus rentable du paquet en volume de
   doc — **découpée en sept lots A→G le 31/08, on commence par A1** (poser le filet sur les deux
   alertes d'appel). Le cadrage a trouvé un **sixième** consommateur du code v1, que le recompte de
   la doc rate : `Server/Server.vue`, par le store `stores/peers.js` et non par `WebRTC/`.
   L'ordre des lots est fixé par [le `work/` du projet hôte](../../../../work/README.md).

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
| [webrtc2-todo.md](webrtc2-todo.md) | ouvert, **un 🔴** | Le suivi vivant du module. **Le 🔴 : accepter un appel vocal entrant ne fait rien** — il se traite dans le lot B de [doc-rustines.md](doc-rustines.md), pas ici. **Un 🟠 de couverture** — aucun scénario n'exerce la topologie star, donc « hub absent → hub présent » n'est épinglé à aucun étage — et **un 🟠 de déploiement**, la bascule `SOCIALIZER_PEER_ATTESTATION_ENFORCE`, dont la procédure impose de lire **deux** indicateurs et jamais un seul. Le reste est de la pérennisation 🟢/🟠 : fidélité du mock PeerJS, observabilité, robustesse, et ce que la couverture des boutons d'appel a ouvert. Les items terminés y sont élagués — leur rationale vit dans [`docs/`](../docs/modules/webrtc2/INDEX.md), leur récit dans `git log`. |
| [doc-rustines.md](doc-rustines.md) | 🟠 démarré — **lot 0 terminé, lot 1 entamé** | rendre la doc exempte d'annotations qui compensent un défaut du code. `webrtc2Events.js` est supprimé (31/08, sortie B). **Reste au lot 1** : migrer les composants vivants qui importent encore la v1 WebRTC — ce qui retire l'annotation de **sept** fichiers de doc, dont le piège n°1 du `CLAUDE.md` et une ligne du `CLAUDE.md` de tout projet hôte — puis vider les cinq poches mortes. **Découpé en sept lots A→G le 31/08** : le filet d'abord, le 🔴 vocal ensuite, le déplacement des alertes, les trois modules data un par un, AudioRoom, la suppression, la doc. Trois faits du cadrage : le provider data v2 existe déjà (rien à écrire), le contrat de callback n'est pas mappable 1 pour 1 (chaque appelant se réécrit), et il y a un **sixième** consommateur hors du recompte. |
| [projection-graphe-todo.md](projection-graphe-todo.md) | ⏸️ **suspendu — au besoin seulement** | suites du correctif « un utilisateur = un mur + un feed ». Rien n'y bloque ; deux items portent une exigence d'exploitation (sauvegarder le space NebulaGraph, que rien ne reconstruira). |
| [chat-tests-plan.md](chat-tests-plan.md) | **non démarré** | plan de tests du Chat en 5 couches ; un seul fichier de test existe. Décision en attente sur les helpers (`mockEcho`, `mockRoute`, `seedChatStore`) : dédiés à Chat, ou promotion des helpers WebRTC2 — le fichier nomme le candidat existant et les deux fidélités qu'un partage naïf effacerait. |
| [front-todo.md](front-todo.md) | **non démarré** | deux items. Le ping d'ouverture de session part avant que pusher n'ait confirmé l'abonnement, et Reverb le rejette — l'utilisateur peut rester hors ligne deux minutes ; le correctif naïf (`subscribed(cb)`) ne part jamais sur un canal déjà confirmé. Et `isEmpty(element.store)` lève sur un commentaire de post chargé par la liste, **dans un listener Reverb donc en silence** — quatre appelants, deux étages possibles pour le correctif. |
| [sass-todo.md](sass-todo.md) | **non démarré** | de la dette de style, et seulement ça depuis que le 🔴 « vignette d'attente invisible » est parti dans le chantier WebRTC2 qui l'avait produit (fermé le 28/08, sans rien devoir à ce fichier). Restent : thème sombre cassé par des couleurs en dur, absence de `_variables.scss` propre au paquet (arbitrage A/B à trancher), URL d'image externe en prod, et les `@extend` de classes Bootstrap à migrer. |
