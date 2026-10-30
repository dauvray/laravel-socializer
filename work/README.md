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
   ✅ **Lot « couper la caméra éteint vraiment la webcam » : clos le 30/10/2026**, sur la
   vérification de David en vrai navigateur. Les items qu'il a ouverts sont en tête du fichier.
   Sa vérification a trouvé un 🔴 antérieur au lot : un appel visio dont la capture caméra est
   refusée restait suspendu, des deux côtés et sans un mot. ▶ **Lot « une capture impossible ne
   suspend plus l'appel » : codé et testé le 30/10/2026**, sur deux décisions de David — la caméra
   manque, l'appel continue caméra coupée ; le micro manque, il sort proprement. 🔴 **Ce 🔴 reste
   ouvert DANS CE FICHIER jusqu'à la vérification de David en vrai navigateur** ; les étapes sont
   en tête du fichier. L'autre lot en attente, décidé le 30/10, est le micro perdu en cours
   d'appel. Le 🔴 précédent, un
   micro coupé reporté à l'appel suivant (fatal en vocal), a été ouvert et fermé le 29/10/2026.
   Un autre 🔴 est ouvert dans le paquet : le tableau blanc (point 3 ci-dessous).
   « accepter un appel vocal entrant ne fait rien » est fermé
   (lot B1), et le second défaut des alertes — le timer d'auto-refus qui survivait au démontage —
   l'est aussi (lot B2, le même jour). Le 🟠 qui les remplaçait — **une seconde invitation PATCHAIT
   l'alerte vivante**, et le second appelant se faisait refuser à la place du premier — est fermé le
   26/10 par le lot B5 : **occupé ⇒ refus**, décision de David. Sa relecture en a ouvert un autre,
   côté appelé — une alerte dont le chunk ne se charge pas était refusée sans qu'il le sache —,
   fermé le même jour par un toast « rechargez la page » ; la cause amont, `vite:preloadError`, est
   une tâche du socle.

   ✅ **Le plan de tests est clos** : les trois étages sont couverts, y compris
   l'étage de présentation, et son fichier de suivi a été supprimé après remontée de son durable
   dans [`docs/architecture/tests.md`](../docs/architecture/tests.md) (la méthode) et
   [`docs/modules/webrtc2/tests.md`](../docs/modules/webrtc2/tests.md) (le harnais).

   **Reste ouvert, aucun bloquant** : la bascule `SOCIALIZER_PEER_ATTESTATION_ENFORCE`, **faite en
   dev le 28/10 et vérifiée à deux navigateurs sur ses quatre issues** — reste le geste chez chaque
   consommateur, après observation —, et des items de pérennisation 🟢/🟠 (fidélité du mock,
   observabilité, robustesse). Le 🟠 de couverture star est fermé le 26/10 par
   `scenarios/starTopology.test.js` : « hub absent → hub présent » est épinglé de bout en bout.

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
   `webrtc-data-v1-v2.md` *(supprimée au lot G, sa condition remplie)* — et le contrat v2 qu'elle a mis au jour est allé
   dans la doc du module, où il manquait. Elle a retourné **deux** affirmations fausses, dont une
   « bonne nouvelle » qui promettait qu'il n'y avait rien à faire.
   **Puis D1 le 01/09** : le Whiteboard est migré, **un seul fichier de code**, et les appelants v1
   vivants passent de quatre à **trois**. Suite JS inchangée (85 fichiers / 1501 cas) et
   `npm run build` vert. 🔴 **Puis la vérification à deux navigateurs a trouvé un défaut réel, et
   c'est le résultat le plus utile de la journée** : les curseurs passaient, aucun dessin ne se
   propageait — PeerJS sérialise en **BinaryPack**, qui **lève** sur la `Map` `collaborators` de
   l'`appState` d'Excalidraw. La v1 ne le voyait pas : `safeStringify` aplatissait tout en chaîne et
   la `Map` y devenait `{}` **par accident**. Le throw étant synchrone dans la boucle de diffusion,
   il sautait aussi le `saveScene` placé après — donc **la persistance était cassée elle aussi**.
   **Correctif gratuit, trouvé en lisant le récepteur avant de choisir comment sérialiser** :
   `ExcalidrawElement.updateScene` lit `data.state`, une clé que **personne n'émet** — l'`appState`
   transmis n'a jamais été appliqué. On ne l'émet plus : la `Map` disparaît, le payload maigrit, et
   rien ne change pour personne. ✅ **Re-vérifié à deux navigateurs : traits et curseurs propagés, zéro
   erreur. D1 est CLOS.** Le cas de l'**image collée** reste rouge et sort du lot — il l'était déjà en
   v1, et il a fait tomber **deux** défauts antérieurs à la migration, désormais tâches du lot 5 : le
   collage n'émet **rien** (aucun `pointerup` ; `onChange` est commenté dans le JSX), et une scène
   portant une image pèse **294 409 octets** — mesuré, **4,5×** le plafond. Les deux se tiennent :
   traiter l'un sans l'autre ne fait rien apparaître chez le pair. **Le lot a corrigé la recette de D0 sur deux points, et les deux servent D2 et D3** :
   `onConnectionOpen` tire dans les **deux sens** en v2 alors que le `callbackConnection` de la v1 ne
   tirait que sur l'entrant — donc « préserver l'effet de bord » ne peut pas se faire par substitution
   (sans garde, chaque pair renvoyait sa scène deux fois ; chez D2, l'iframe recevrait une annonce de
   pair **me désignant moi**) — et le plafond de 64 Ko de `sendData` est une **régression** de la v2
   sur la v1, qui n'avait aucune limite. La scène Excalidraw est le seul payload du paquet dont la
   taille est pilotée par l'utilisateur : borne **assumée** à D1, avec sa tâche ouverte au lot 5.
   **Le lot D est CLOS le 01/09** — D0, D1, D2, D3 ; **le code du lot E (AudioRoom) est fait le
   26/10**, vérif à deux navigateurs comprise : **le lot E est CLOS** — voir plus bas.
   **B5 est fermé le 26/10, avec B3 et B4 : le lot B est clos** — après une relecture qui a réfuté
   le repli de B3 (une alerte dont le chunk ne se charge pas gardait le créneau) et l'a fait étendre
   aux chunks rejetés et pendus, puis prévenir l'appelé ; la cause amont est confiée au socle. Le reste de la migration des appelants de WebRTC v1 est la tâche la plus
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

   **Puis D2 le 01/09** : Application est migré, un seul fichier de code, appelants v1 vivants de
   trois à **deux** et consommateurs du store v1 de cinq à **quatre**. Build vert, suite sans échec,
   **vérif à deux navigateurs passée le 26/10** (David). Il a confirmé la règle de D1 en
   trouvant la **troisième** erreur de la recette : `onConnectionClose` y était donné pour
   « indemne » du problème de sens, et il ne l'est pas — le garde `customCloseEmitted` ne promet
   qu'une notification **par connexion**, or la paire en a deux. Il a fermé le point produit d'`exclude`
   (le ciblage survit en entier, complément calculé chez l'appelant) et **refermé** la régression de
   sérialisation que D1 avait assumée, parce qu'ici le payload vient d'une **app d'iframe** écrite
   hors du paquet — et sans rien coûter, le récepteur JSON-round-trip déjà le message.
   🔴 **Le fait le plus utile de D2 ne vient pas de D2** : `connectionEnabled` sur une entrante
   signifie « ce pair m'a joint », **pas** « je peux lui répondre » — `sendData` résout par slug dans
   une map qui ne contient que mes sortantes. L'écart se compte en **secondes**
   (`scenarios/incomingMappingInvariant.test.js`). Le ✅ de l'iframe est un indicateur d'affichage.

   ⚠️ **Ce que D2 ajoute à la méthode, et qui n'était pas dans le gabarit : deux agents sur un seul
   arbre.** Le paquet vivant dans `vendor/`, une branche par lot n'isole **rien** (fichiers partagés,
   un `git checkout` écrase le non-committé de l'autre) et un `git worktree` serait **intestable**
   (l'hôte résout `~socializer` sur `vendor/`, donc ni la suite ni `npm run build` ne verraient le
   worktree). Ce qui protège : **fichiers disjoints, commit par chemins explicites, jamais
   `git commit -a`**. Corollaire sur les mesures : **un décompte de suite mesuré à deux n'est pas une
   preuve de non-régression** — ce qui reste prouvable est « aucun échec imputable à ce fichier », et
   il faut savoir le justifier autrement que par un chiffre.

   ⚠️ **Et le 🔴 de D1 ajoute le degré au-dessus : sur ce module, la vérification manuelle n'est pas
   une formalité de fin de lot, c'est le seul contrôle qui exerce le transport réel.** Suite verte,
   build vert, trois relectures — et le tableau ne propageait rien. **Aucun test de la suite ne
   pouvait le voir, ni ne le pourra** : `conn.send` y est un `vi.fn()`, le harnais n'a pas de
   BinaryPack. Ce qui reste épinglable est la moitié amont (le garde de taille laisse passer une
   `Map`), et c'est écrit comme telle, avec l'avertissement de ne pas la lire comme une garantie.
   Corollaire pour D2, D3 et E : **ne pas cocher un lot data sur la seule foi du vert.**

   **Puis D3 le 01/09 : ClassRoom est migré, et le lot D est CLOS.** Un seul fichier de code,
   appelants v1 vivants de deux à **un** (`AudioRoom`, un provider **media** — c'est le lot E) et
   consommateurs du store v1 de quatre à **trois**, dont deux partent avec le dossier : **plus aucun
   appelant du canal data n'est branché sur `stores/peers.js`**. Build vert, suite JS 87 fichiers /
   1518 cas sans échec, **vérif à deux navigateurs passée le 26/10** (David).
   ✅ **C'est le plus petit des trois, et ça se mesure** : sa v1 ne portait **aucun** effet de bord de
   connexion — trois `console.log`, non reportés. Donc `onDataReceived` seule clé du jeu, et **aucun
   garde de sens à écrire**. Le piège qui a coûté un correctif à D1 et un à D2 ne le concernait pas.
   ⚠️ **Il a trouvé la quatrième erreur de la recette, et c'est une espèce que le chantier n'avait
   pas rencontrée : le fait EXACT mais SANS OBJET.** Elle instruisait « ClassRoom lit
   `conn.connectionId` (journalisation) : inchangé en v2 ». Vérifiable, vrai — et portant sur une
   ligne que le lot allait **supprimer**. Après le *décompte* (lot C), la *mesure de contrôle à 0*
   (A3) et la *bonne nouvelle* (D0), voici l'annotation qui n'est fausse en rien et coûte quand même,
   parce qu'on l'instruit avant de découvrir qu'elle ne survit pas à la migration qu'elle décrit. Le
   test qui la repère tient en une question : **cette phrase parle-t-elle d'un code qui existera
   encore après le lot ?**
   🔴 **Et la trouvaille la plus utile de D3 ne vient pas de son code** :
   `docs/modules/autres-modules.md` donnait ClassRoom pour « le cas d'usage type de la topologie
   **star** ». Faux depuis toujours — la v1 qu'il utilisait n'a **aucune notion de topologie**. Le
   coût était réel et daté : cette ligne poussait celui qui fait *cette* migration à écrire
   `:options="{ topology: 'star' }"`, or passer un objet `options` **efface le défaut EN BLOC** et
   fait disparaître `topology`. **Une caractérisation fausse est pire qu'un décompte faux : elle ne
   se périme pas, elle n'a jamais été vraie** — donc aucune relecture de décomptes ne la rattrape, et
   seul le lot qui touche le module la croise.
   ℹ️ Ce que D3 a mesuré et qu'aucun lot précédent n'avait eu à mesurer : **le cycle démonter /
   remonter d'un contexte data**. ClassRoom démonte le Whiteboard imbriqué sur une bascule ; avant
   D3 les deux piles étaient disjointes (lui en v1, le tableau en v2), après D3 les deux contextes v2
   partagent le même `Peer` et le même store. Le chemin est prévu et gardé — `closePeerConnection`
   scopé à la room, `removeRemotePeerId` conditionné à `isUserInAnyRoom`, `stopSignaling` par
   contexte, `unregisterContext` à identité vérifiée (`contextRegistry.get(id) === ctx`) — et deux
   cas de `scenarios/multiContext.test.js` le portent. **Mais rien de tout ça n'exerce le transport
   réel** : d'où l'item « bascule off→on » ajouté à la vérif manuelle, seul geste qui le falsifie.

   **Puis le lot E le 26/10 : AudioRoom est migré : aucun composant n'importe plus `components/WebRTC/` ; seul `Server.vue` importe encore le store v1, sans le lire (F1).** Quatre
   commits, dont deux qui ne sont pas de la migration : AudioRoom est le **premier consommateur de
   production du mode `stream`**, et lire son chemin de réception a trouvé deux 🔴 du **cœur v2** —
   le TTL du registre évinçait un flux **vivant** au bout de 5 min (A cesse d'entendre B quand C
   arrive), et le teardown du provider **n'arrêtait aucun flux local** (quitter la page laissait le
   micro ouvert). Les deux étaient *écrits* — « sans activité », « arrêt des flux, etc. » — sur un
   code qui ne les tenait pas. Corrigés en sortie A, nés rouges, mutations mesurées. Puis E1, un seul
   fichier : le vrai travail était le **rendu des flux distants**, que le mode `stream` laisse à
   l'appelant — sans lui, la migration « marchait » sans un son. Puis E2 : `SpectrumAnalyzer`
   **supprimé** (décision de David), il rejouait l'audio une seconde fois. Suite JS 87 fichiers /
   1525 cas, build vert. **Vérif à deux navigateurs passée le 26/10** (David), cinq étapes sur cinq — dont la survie d'un
   flux de plus de 5 min à l'arrivée d'un tiers, premier exercice réel d'E0a : **E est CLOS, F peut
   partir**. Chaque
   commit est passé par **une seconde session relectrice** avant d'être fait — elle a trouvé au
   premier un mutant (`.every`) qui survivait au jeu de cas.

   **Puis le lot F le 26/10 : la v1 est supprimée** — `components/WebRTC/`, le store `stores/peers`,
   l'import mort de `Server.vue`, et `__AudioComponent copy.vue`, que le périmètre écrit omettait
   alors que sa preuve (« les deux greps rendent zéro ») l'exigeait. Suite JS inchangée ; build
   vert — le chunk `Server` perd le store v1 (30 → 19 Ko) et les 8 chunks `callbacks/` disparaissent.
   La suppression laisse `callbacks/` orphelin en entier, consigné dans les poches mortes. Le store
   v1 l'atteignait par deux `import()` à gabarit : un grep des backticks les trouve, mais seul le
   **diff des chunks** entre les deux builds dit ce qu'ils atteignaient. **Reste G, la doc — et elle est fausse depuis F**, plus seulement
   à retirer : aucun tag avant G.

   **Puis le lot G le 26/10 : la doc ne parle plus de la v1, et la tâche est CLOSE.** Neuf fichiers
   de doc et la guideline livrée, le bloc de l'hôte régénéré (seules les trois lignes v1 en sortent),
   la recette `webrtc-data-v1-v2.md` supprimée. Sa suppression n'était pas une formalité : sur sa
   promesse « tout ce qui concerne la v2 est dans `api.md` », **quatre contrats v2 n'existaient
   qu'en elle** (un `options` partiel remplace le défaut en bloc ; sans `room`, le contexte tombe sur
   le `data-app` permanent de `Notifications.vue` ; le provider rend un `<div>` ; `users` se
   réaffecte, jamais ne se mute — ce dernier trouvé par la relecture), remontés dans
   `api.md` avant la suppression. Et la liste de G en omettait **deux** fichiers : `conventions.md`
   (trouvé à la relecture de F) et `signalisation.md` (trouvé par l'inventaire de G), où la v1
   justifiait encore un `nullable` — même justification dans un commentaire PHP et un docblock de
   test, corrigés avec lui. La règle reste `nullable`.

   Ce que le troisième harnais a coûté, et qui vaut pour le prochain composant testé sous horloge
   factice : **deux minuteurs parasites** que `vi.getTimerCount()` compte sans qu'ils appartiennent
   au composant — `defineAsyncComponent` arme un `setTimeout` de 200 ms **même sans option** (son
   `delay` par défaut, jamais annulé), et le renderer de Vue en arme un de 3 s à sa création, une
   fois par fichier. Un comptage absolu est donc faux ; le détail est dans le docblock du fichier.

3. 🔴 **[whiteboard-todo.md](whiteboard-todo.md) — les deux routes du tableau blanc n'ont aucune
   garde d'autorisation.** Ouvert le 01/09/2026. Un autre 🔴 est ouvert : WebRTC2 (point 1).
   `server_id`,
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
| [webrtc2-todo.md](webrtc2-todo.md) | ouvert, **un 🔴** | Le suivi vivant du module. **Le 🔴, en vérification depuis le 30/10 : une capture impossible ne suspend plus l'appel — caméra manquante, il continue caméra coupée ; micro manquant, il sort proprement** — codé et testé, il attend la vérification de David en vrai navigateur. **Un 🟠 de déploiement** en tête, la bascule `SOCIALIZER_PEER_ATTESTATION_ENFORCE` — **faite en dev le 28/10, vérifiée à deux navigateurs** ; reste le geste chez chaque consommateur, dont la procédure impose de lire **deux** indicateurs et jamais un seul. Sa vérification a corrigé un invariant de `securite.md` : en conditions réelles le mapping gagne la course, et l'attestation n'est consultée que pour un peerId que la signalisation n'a jamais nommé. Le reste est de la pérennisation 🟢/🟠 : fidélité du mock PeerJS, observabilité, robustesse, et ce que la couverture des boutons d'appel a ouvert. Les items terminés y sont élagués — leur rationale vit dans [`docs/`](../docs/modules/webrtc2/INDEX.md), leur récit dans `git log`. |
| [doc-rustines.md](doc-rustines.md) | 🟠 démarré — **lot 0 terminé, lot 1 entamé** | rendre la doc exempte d'annotations qui compensent un défaut du code. `webrtc2Events.js` est supprimé (31/08, sortie B), le filet du lot A1 est posé, **B1, B2 et C sont fermés (31/08)** — B2 en sortie A + sortie B, avec le troisième harnais (faux timers, 9 cas dont 5 rouges) et **deux bornes de durée retirées des docblocks de A1 avec leur cause** ; C a sorti les deux alertes d'appel de l'arbre v1 sans toucher une ligne de test. Le cadrage de B2 a ouvert **B5**, la face vive de la même famille — **fermé le 26/10 avec B3 et B4 : le lot B est clos**, sur la décision « occupé ⇒ refus ». **Le lot A est clos (01/09)** : A2 a établi que la liste de présence est *réaffectée* et non mutée en place — donc rien à adapter au lot D —, et A3 a posé le filet qui manquait sur ce contrat, jusque-là épinglé à aucun bout. **Puis D0 (01/09)** : la traduction v1 → v2 est écrite une fois — `webrtc-data-v1-v2.md` (supprimée au lot G) pour le delta, `docs/modules/webrtc2/api.md` pour le contrat v2 qui n'y était pas — et elle a retourné **deux** affirmations fausses, dont la « bonne nouvelle » qui promettait que les `JSON.parse` des trois appelants survivaient. **Puis D1 (01/09)** : le Whiteboard est migré en un seul fichier de code, la suite JS est inchangée (85 fichiers / 1501 cas) et le build vert — **sa vérif à deux navigateurs reste ouverte** *(passée depuis)*. Il a corrigé la recette de D0 sur **deux** points valables pour D2 et D3 : `onConnectionOpen` tire dans les **deux sens** (donc « préserver l'effet de bord » n'est pas une substitution — chez D2, l'iframe recevrait une annonce de pair **me désignant moi**), et le plafond de 64 Ko de `sendData` est une **régression** sur la v1 qui n'en avait aucun, assumée avec sa tâche ouverte au lot 5. ⚠️ Son chiffre de clôture n'est pas 1501 mais **1503** : son propre correctif a ajouté deux cas après que la phrase ci-dessus a été écrite — un décompte périmé **à l'intérieur de sa propre tâche**. **Puis D2 (01/09)** : Application est migré, un seul fichier de code, appelants v1 vivants de trois à **deux** et consommateurs du store v1 de cinq à **quatre** ; build vert, **vérif à deux navigateurs passée le 26/10**. Il a trouvé la **troisième** erreur de la recette (`onConnectionClose` n'est PAS « indemne » du problème de sens : une notification par connexion, mais deux connexions par paire), **fermé** le point produit d'`exclude` — le ciblage survit en entier, complément calculé chez l'appelant — et **refermé** la régression de sérialisation que D1 avait assumée, parce qu'ici le payload vient d'une app d'iframe écrite hors du paquet. 🔴 Son fait le plus utile ne vient pas de lui : `connectionEnabled` sur une entrante dit « ce pair m'a joint », **pas** « je peux lui répondre » — l'écart se compte en secondes. **Puis D3 (01/09) : ClassRoom est migré et le lot D est CLOS** — un seul fichier, appelants v1 vivants de deux à **un**, consommateurs du store v1 de quatre à **trois** (dont deux partent avec le dossier : **plus aucun appelant du canal data n'est branché sur le store v1**) ; build vert, suite 87 fichiers / 1518 cas, **vérif à deux navigateurs passée le 26/10**. C'est le plus petit des trois parce que sa v1 ne portait **aucun** effet de bord de connexion — trois `console.log` non reportés, donc **aucun garde de sens à écrire**, seul des trois dans ce cas. Il a trouvé la **quatrième** erreur de la recette, d'une espèce neuve : **un fait EXACT mais SANS OBJET** (`conn.connectionId`, décrit sur une ligne que le lot allait supprimer). 🔴 Et sa trouvaille la plus utile ne vient pas de son code : `autres-modules.md` donnait ClassRoom pour « le cas d'usage type de la topologie **star** » — faux depuis toujours, la v1 n'ayant aucune notion de topologie, et **dangereux ici précisément**, puisque passer un objet `options` efface `topology` en bloc. **La suite est E.** **Reste au lot 1** : migrer **l'unique** composant vivant qui importe encore la v1 WebRTC — ce qui retire l'annotation de **sept** fichiers de doc, dont le piège n°1 du `CLAUDE.md` et une ligne du `CLAUDE.md` de tout projet hôte — puis vider les cinq poches mortes. **Découpé en sept lots A→G le 31/08** : le filet d'abord, le correctif vocal ensuite, le déplacement des alertes, les trois modules data un par un, AudioRoom, la suppression, la doc. Trois faits du cadrage : le provider data v2 existe déjà (rien à écrire), le contrat de callback n'est pas mappable 1 pour 1 (chaque appelant se réécrit), et il y a un **sixième** consommateur hors du recompte — d'où les **deux** greps de la commande corrigée au lot C. **Au 26/10 : lots A, C, D faits, E CLOS (vérif à deux navigateurs passée), F et G faits — la v1 n'est plus dans l'arbre ni dans la doc, et la tâche est CLOSE.** |
| [whiteboard-todo.md](whiteboard-todo.md) | **ouvert — un 🔴** | le tableau blanc côté SERVEUR : son service PHP, ses deux routes, sa persistance. **Ne parle pas de WebRTC.** Un seul item, et c'est une politique à trancher avant d'écrire une ligne : `saveWhiteBoard` / `loadWhiteBoard` n'ont aucune garde d'autorisation, leurs trois ids viennent du client, donc tout connecté lit ou écrase le tableau de n'importe quelle room — et l'écriture réattribue `model_id` au passage, ce qui efface la trace de la victime. Le fichier nomme les **deux** façons dont le correctif naïf (`canJoinRoom`) serait faux, et l'usage modèle à imiter (`Services/Chat.php:119`, apparié à `isCreator`). Les trois défauts du chemin de CHARGEMENT ne sont pas ici : lot 5 de [doc-rustines.md](doc-rustines.md), et non recopiés. |
| [projection-graphe-todo.md](projection-graphe-todo.md) | ⏸️ **suspendu — au besoin seulement** | suites du correctif « un utilisateur = un mur + un feed ». Rien n'y bloque ; deux items portent une exigence d'exploitation (sauvegarder le space NebulaGraph, que rien ne reconstruira). |
| [chat-tests-plan.md](chat-tests-plan.md) | **non démarré** | plan de tests du Chat en 5 couches ; un seul fichier de test existe. Décision en attente sur les helpers (`mockEcho`, `mockRoute`, `seedChatStore`) : dédiés à Chat, ou promotion des helpers WebRTC2 — le fichier nomme le candidat existant et les deux fidélités qu'un partage naïf effacerait. |
| [front-todo.md](front-todo.md) | **non démarré** | trois items. La prop `room` d'Application rend `undefined` par défaut, et c'est ce qui la protège : le correctif évident `() => ({})` ferait tomber son provider sur le contexte permanent `data-app` (26/10). Le ping d'ouverture de session part avant que pusher n'ait confirmé l'abonnement, et Reverb le rejette — l'utilisateur peut rester hors ligne deux minutes ; le correctif naïf (`subscribed(cb)`) ne part jamais sur un canal déjà confirmé. Et `isEmpty(element.store)` lève sur un commentaire de post chargé par la liste, **dans un listener Reverb donc en silence** — quatre appelants, deux étages possibles pour le correctif. |
| [sass-todo.md](sass-todo.md) | **non démarré** | de la dette de style, et seulement ça depuis que le 🔴 « vignette d'attente invisible » est parti dans le chantier WebRTC2 qui l'avait produit (fermé le 28/08, sans rien devoir à ce fichier). Restent : thème sombre cassé par des couleurs en dur, absence de `_variables.scss` propre au paquet (arbitrage A/B à trancher), URL d'image externe en prod, et les `@extend` de classes Bootstrap à migrer. |
