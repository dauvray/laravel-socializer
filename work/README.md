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

1. [doc-rustines.md](doc-rustines.md) — le volet de ce paquet dans le chantier transverse. **Lots 0
   et 1 terminés, à une tâche près** : la migration des appelants de WebRTC v1 (lots A → G) est
   close le 26/10/2026, et il reste à vider les cinq poches mortes. Les lots 3, 4 et 5 sont
   ouverts. Les leçons de méthode du chantier sont dans
   [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md).

2. 🔴 **[whiteboard-todo.md](whiteboard-todo.md) — les deux routes du tableau blanc n'ont aucune
   garde d'autorisation.** Ouvert le 01/09/2026. `server_id`,
   `room_id` et `vertex_id` viennent du client et ne sont confrontés à rien
   (`app/Services/WhiteBoard.php`, deux fois `// todo a protéger`) : **tout utilisateur connecté peut
   lire ou écraser le tableau de n'importe quelle room.** Périmètre borné par le groupe de routes
   `private` — donc pas un anonyme —, et `save_board` n'y change rien, il ne décide que si le
   *client* appelle.

   ⚠️ **Ce n'est pas un oubli de garde, c'est une politique absente**, d'où sa place en tête de son
   fichier plutôt que dans un lot : qui a le droit d'écrire, qui a le droit de lire, et sur quoi
   porte le contrôle — le triplet d'ids n'est recoupé nulle part. La réponse n'est pas déductible du
   code, elle appartient à David.

   ⚠️ **Le correctif naïf est faux DEUX fois** et le fichier le développe : `canJoinRoom` n'est PAS
   un prédicat d'appartenance (vrai pour n'importe quel couple sur `privacy == 0`, et une room
   publique vide refuse jusqu'à son propriétaire). Ne pas non plus généraliser depuis ses sœurs, qui
   le sont, elles.

   ℹ️ **Indépendant du correctif du renvoi de scène** livré le même jour (`512afca`), qui n'a ni
   ouvert ni refermé quoi que ce soit ici.

> ⏸️ **[projection-graphe-todo.md](projection-graphe-todo.md) est suspendu — au besoin seulement.**
> Ses items restants sont 🟢/🟠 et ne bloquent rien. **Ne pas le rouvrir parce qu'une lecture de code
> y ramène** : y verser un constat sans rouvrir le chantier est l'usage prévu. La raison de la
> prudence est dans son en-tête — chaque item y *paraît* petit et adjacent au précédent, et c'est
> exactement comme la dérive s'est produite.

> ⏸️ **[webrtc2-todo.md](webrtc2-todo.md) est gelé depuis le 30/10/2026 — au besoin seulement.**
> Aucun 🔴 ; le module sert en l'état, et aucun projet autre que le bac à sable ne consomme le
> paquet. Ce qu'il faut pour le rouvrir, et ce que le gel ne suspend pas, sont dans son en-tête.

---

## Hors chantier

- [ ] 🟠 **`$result[0]` non gardé sur un retour NebulaGraph — une FAMILLE, pas un incident** `[M]`
  — ouvert le 01/09/2026, en réparant la création d'une room ClassRoom. L'item vit ici : il ne
  relève d'aucun chantier existant, et surtout **pas** de
  [projection-graphe-todo.md](projection-graphe-todo.md), qui est suspendu.

  `$this->nebula->execute()` rend **un tableau vide** quand la requête ne matche rien — ce qui n'est
  pas une anomalie mais un cas nominal : un id qui ne porte pas le tag attendu, un vertex supprimé,
  une arête absente. Tout `$result[0]` écrit sans garde lève alors **« Undefined array key 0 »**.

  ⚠️ **Ce n'est pas théorique, c'est le bug vécu du 01/09** : `createClassroomVertice` passait l'id
  d'un vertex `classroom` à `getOrcreateChatVertice`, dont la requête ne matche que `(r:room)`. La
  création de la room s'interrompait au milieu, laissant un salon **inouvrable**. Corrigé aux deux
  bouts (`92cefa9`), mais **seulement à ces deux bouts**.

  **Quatre autres sites, vérifiés un par un — ce sont les seuls dont la portée est établie :**

  | Site | Se déclenche quand | Effet |
  |---|---|---|
  | `Services/Server.php:929` — `$result['content'][0]['content_type']` | une room **sans contenu** est ouverte | casse `getRoom`, donc **toute** vue de salon |
  | `Services/Server.php:994-998` — `$content[0]['type']`, `$content[0]['content']['id']` | on **modifie** une room sans contenu publié | casse `updateRoomServer` |
  | `Services/Chat.php:516` — `$result[0]['messages']` | le vertex chat n'existe plus (id périmé) | casse `getConversation` |
  | `Services/Chat.php:610` — `$owner_id[0]` | le chat n'a pas d'arête `has_creator` | casse `deleteConversation` |

  ⚠️ **Le `try/catch` de `updateRoomServer` ne protège PAS**, et c'est le piège à ne pas reproduire :
  il n'attrape que `NebulaGraphException`. Une « Undefined array key » est une `ErrorException` —
  elle passe **à travers**. Un site entouré d'un `try` n'est donc pas un site gardé.

  ℹ️ **Un chiffre à ne PAS croire tel quel** : `grep '\$result\[0\]\|\$content\[0\]\|\[0\]\['` sur
  `src/app/Services/*.php` rend **48** occurrences réparties sur six services (Server 31, Chat 10,
  Comments 6, Users 4, Feed 2, ApplicationIA 2). C'est une **borne d'instruction, pas un décompte de
  défauts** : ces 48 sites n'ont pas été triés, et certains sont légitimement précédés d'une garde.
  Le travail de ce lot est précisément ce tri — et le chiffre juste sera celui qu'il produira.

  **La question à trancher avant d'écrire une ligne**, parce qu'elle décide de tout le reste :
  garder **site par site**, ou faire rendre à la couche d'accès un objet qui ne peut pas être
  indexé à vide ? Le second referme la famille entière et ne se refera jamais ; il touche en
  revanche tous les services d'un coup, donc il se prépare avec son filet — et la suite PHP
  (286 tests) ne couvre aujourd'hui que la signalisation WebRTC et les gardes de `Socializable`.

- [ ] 🟠 **Un auteur d'article en corbeille fait échouer toute la projection du graphe** `[S]` —
  relevé le 23/08/2026 dans [projection-graphe-todo.md](projection-graphe-todo.md) §8, sorti ici le
  30/10/2026 : ce chantier est suspendu, et le défaut, lui, est actif.

  `GraphProjection::projectArticleAuthors()` lit `$article->author->id` sans garde. `EstarterUser`
  est en `SoftDeletes` et la relation `author` d'eblogger ne prend pas `withTrashed` : pour un
  article dont l'auteur est en corbeille, `$article->author` vaut `null`. Deux appelants, la
  migration `create_nebula` et `nebula-populate` — **un seul auteur en corbeille les fait échouer
  en entier**, alors que le docblock de la classe cite ce cas comme exemple de ce que le rattrapage
  par item protège.

  ⚠️ **Même piège que l'item ci-dessus, et le texte d'origine se trompait de cause.** Lire une
  propriété sur `null` n'est pas une `Error` PHP : c'est un avertissement, que Laravel convertit en
  `ErrorException` (une `\Exception`). Elle traverse `tentative()`, qui ne capte que
  `NebulaGraphException` — et un `catch (\Error)` ne la verrait pas non plus. Le correctif : une
  garde sur l'auteur absent, qui signale l'article par `onFailure` et passe au suivant.

  Non reproduit : `nebula-populate` n'a pas été lancé avec un auteur en corbeille (il faudrait
  écrire des données). Le mécanisme est mesuré — l'avertissement dans le PHP du conteneur, sa
  conversion dans la source de `HandleExceptions`.

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
| [application-v2-todo.md](application-v2-todo.md) | **non démarré** (ouvert le 28/10) | Apps **multi-fichiers** dans un salon Application, et un **éditeur de vibe coding** : fil avec un agent codeur **et** édition à la main. Compilation SFC côté serveur, iframe à **origine opaque**, pont `postMessage` seul contrat, **aucun composant maison dans l'iframe** (abandonné sur mesure). Cinq lots ordonnés par dépendances ; **le lot 1, droits et injection nGQL, est dû indépendamment du projet** : aujourd'hui tout connecté réécrit le code de n'importe quelle app, qui tourne same-origin chez chaque membre. Quatre décisions attendent David en tête du fichier. |
| [webrtc2-todo.md](webrtc2-todo.md) | ⏸️ **gelé le 30/10/2026 — au besoin seulement**, aucun 🔴 | Le backlog du module, gelé en l'état. En tête, le 🟠 du 30/10 : une capture qui ne rejette pas (webcam débranchée) laisse l'appel sur le spinner. **Un 🟠 de déploiement** : la bascule `SOCIALIZER_PEER_ATTESTATION_ENFORCE`, faite et vérifiée en dev le 28/10 ; reste le geste chez chaque consommateur, dont la procédure impose de lire **deux** indicateurs et jamais un seul. Le reste est de la pérennisation 🟢/🟠 : fidélité du mock PeerJS, observabilité, robustesse, boutons d'appel, et une surveillance conditionnelle (taille de `usePeerTransport.js`). Les items terminés en sont élagués — leur rationale vit dans [`docs/`](../docs/modules/webrtc2/INDEX.md), leur récit dans `git log`. |
| [doc-rustines.md](doc-rustines.md) | 🟠 **lots 0 et 1 terminés, à une tâche près** | rendre la doc exempte d'annotations qui compensent un défaut du code. La migration WebRTC v1 → v2 (lots A → G) est close le 26/10 ; reste au lot 1 les cinq poches mortes, puis les lots 3 (noms qui mentent), 4 (épingler par un test) et 5 (à arbitrer, ou assumer). |
| [whiteboard-todo.md](whiteboard-todo.md) | **ouvert — un 🔴** | le tableau blanc côté SERVEUR : son service PHP, ses deux routes, sa persistance. **Ne parle pas de WebRTC.** Un seul item, et c'est une politique à trancher avant d'écrire une ligne : `saveWhiteBoard` / `loadWhiteBoard` n'ont aucune garde d'autorisation, leurs trois ids viennent du client, donc tout connecté lit ou écrase le tableau de n'importe quelle room — et l'écriture réattribue `model_id` au passage, ce qui efface la trace de la victime. Le fichier nomme les **deux** façons dont le correctif naïf (`canJoinRoom`) serait faux, et l'usage modèle à imiter (`Services/Chat.php:119`, apparié à `isCreator`). Les trois défauts du chemin de CHARGEMENT ne sont pas ici : lot 5 de [doc-rustines.md](doc-rustines.md), et non recopiés. |
| [projection-graphe-todo.md](projection-graphe-todo.md) | ⏸️ **suspendu — au besoin seulement** | suites du correctif « un utilisateur = un mur + un feed ». Rien n'y bloque ; deux items portent une exigence d'exploitation (sauvegarder le space NebulaGraph, que rien ne reconstruira). |
| [chat-tests-plan.md](chat-tests-plan.md) | **non démarré** | plan de tests du Chat en 5 couches ; un seul fichier de test existe. Décision en attente sur les helpers (`mockEcho`, `mockRoute`, `seedChatStore`) : dédiés à Chat, ou promotion des helpers WebRTC2 — le fichier nomme le candidat existant et les deux fidélités qu'un partage naïf effacerait. |
| [front-todo.md](front-todo.md) | **non démarré** | quatre sujets. La prop `room` d'Application rend `undefined` par défaut, et c'est ce qui la protège : le correctif évident `() => ({})` ferait tomber son provider sur le contexte permanent `data-app` (26/10). Le ping d'ouverture de session part avant que pusher n'ait confirmé l'abonnement, et Reverb le rejette — l'utilisateur peut rester hors ligne deux minutes ; le correctif naïf (`subscribed(cb)`) ne part jamais sur un canal déjà confirmé. Et `isEmpty(element.store)` lève sur un commentaire de post chargé par la liste, **dans un listener Reverb donc en silence** — quatre appelants, deux étages possibles pour le correctif.Et une décision produit : AudioRoom n'a pas de bouton Mute, le seul moyen de couper son micro est de quitter le salon. |
| [sass-todo.md](sass-todo.md) | **non démarré** | de la dette de style, et seulement ça depuis que le 🔴 « vignette d'attente invisible » est parti dans le chantier WebRTC2 qui l'avait produit (fermé le 28/08, sans rien devoir à ce fichier). Restent : thème sombre cassé par des couleurs en dur, absence de `_variables.scss` propre au paquet (arbitrage A/B à trancher), URL d'image externe en prod, et les `@extend` de classes Bootstrap à migrer. |
