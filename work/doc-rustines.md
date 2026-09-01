# Dé-rustiner la doc — volet socializer

> **Chantier ouvert — lot 0 terminé.** Objectif : que `docs/`, `CLAUDE.md` et
> `resources/boost/guidelines/core.blade.php` ne contiennent plus de passage qui n'existe que pour
> compenser un défaut du code.
>
> **Quatre sorties** pour une annotation : **A** corriger le code · **B** supprimer (code mort ou
> annotation périmée) · **C** épingler par un test le comportement voulu mais contre-intuitif —
> la doc garde une ligne, le nom du test · **D** assumer par une décision datée.
>
> **Trois volets** par tâche, et elle n'est finie qu'aux trois : **code**, **doc** (retirée de
> *chaque* couche listée), **tests** (rouge d'abord, puis vert, suite complète verte).
>
> Après tout retrait dans `resources/boost/guidelines/`, côté projet hôte :
> `artisan boost:update` **puis** `grep 'laravel-socializer/core rules ===' CLAUDE.md`.

**Ce paquet est le seul à avoir un filet** : une suite JS fournie, plus une suite PHP sur la
signalisation. Il peut donc sortir en **C** là où les autres ne peuvent pas — c'est un avantage,
pas un détail. Les décomptes se relisent dans la sortie du runner ; ne pas les recopier ici.

```bash
npm run test:run                      # JS — DEPUIS LA RACINE DU PROJET HÔTE
composer install && vendor/bin/phpunit  # PHP — depuis ce paquet
```

> ⚠️ **Ne pas dupliquer les chantiers déjà ouverts.** Plusieurs rustines de la doc y sont déjà
> cadrées, avec leur analyse : [webrtc2-todo.md](webrtc2-todo.md) et
> [sass-todo.md](sass-todo.md) (thème sombre, `@extend`). Ce fichier y **renvoie** — une règle, un
> seul endroit.
>
> ℹ️ **Le plan de tests WebRTC2 est clos et son fichier supprimé.** Son durable est remonté dans
> [`docs/architecture/tests.md`](../docs/architecture/tests.md) — la méthode : comment lire un
> contrôle à 0, et le 0 croisé qui décide du découpage en fichiers — et dans
> [`docs/modules/webrtc2/tests.md`](../docs/modules/webrtc2/tests.md) pour le harnais. Ne pas le
> chercher, ne pas le recréer.
>
> Le **chantier de sécurité d'août 2026 est clos** : ce qu'il portait (TURN, `getUsersList`, dérive
> du réplica, écritures muettes) est livré, et son durable est dans
> [`docs/modules/webrtc2/securite.md`](../docs/modules/webrtc2/securite.md). Les entrées de ce
> fichier qui lui renvoyaient renvoient désormais à cette doc.

---

## Ordre vis-à-vis du module WebRTC2

**Le chantier de sécurité est clos (F1, 25/08/2026), et ses collisions avec ce fichier sont levées.**
F1 a remonté son durable dans `securite.md`, `architecture.md` et `architecture/signalisation.md`,
**pas dans le `CLAUDE.md`** : les tâches ci-dessous ne le doublent pas, elles couvrent ce qu'il ne
couvrait pas.

Les cinq tâches du lot 0 ont été faites du 15 au 21/08 sans jamais croiser WebRTC2 — la doctrine
« le lot 0 se fait sans attendre » a tenu. **Le lot 0 n'a plus de tâche prête** : sa sixième entrée
attend, comme les autres lots.

### Collisions — toutes levées sauf une

| Tâche d'ici | État |
|---|---|
| ~~Renommer `canJoinRoom` / `canJoinServer` (lot 3)~~ | **Débloqué le 21/08** : E4.1 est livrée, les quatre gardes refusent par défaut et `canJoinchatRoom` exige l'appartenance. Le renommage ne touche plus au comportement, seulement aux noms et à leurs appelants |
| ~~Renommer `hasOpenConnection` / `isConnectionEstablished` (lot 4)~~ | **Débloqué** : les gardes des lots A et B sont livrés et épinglés. ⚠️ Reste un renommage sur un chemin de sécurité — les deux prédicats sont ce que lit le moteur de retry, et les confondre est la panne du 13/08 |
| ~~Renommer `remoteStreams` (lot 3)~~ | **Débloqué** : `createPeerContext` ne bouge plus |
| ~~Convertir les 9 pièges de mock en tests (lot 4)~~ | **Débloqué** : le plan de tests est clos, le harnais a cessé de bouger. C'était la dernière collision |
| ~~Migrer les appelants v1 (lot 1)~~ | **Débloqué** : plus aucun audit en cours sur `Notifications.vue` ni `AlertComponent.vue` |

ℹ️ Le `[L]` « déplacer le routage star », longtemps gelé, **ne l'est plus** : (a) est faite — la
décision de routage vit dans `usePeerTransport.routeIncomingData` — et (b), le routeur générique, est
tranchée en **sortie D** (pas de SFU maintenant ; la couture est recensée dans
[webrtc2-todo.md](webrtc2-todo.md)). Plus aucune collision ouverte avec le module WebRTC2.

### Faisable en parallèle sans aucun risque

Aucun de ces éléments n'est dans l'arbre WebRTC2 : `ACCESORS`, la casse de `Widgets/`, et les
quatre zones mortes (`admin.php`, `console.php`, `table_names`, `SocializerUpgrade`).
`EventBus/webrtc2Events.js` en faisait partie — fait le 31/08, et la prédiction a tenu : la
suppression n'a touché aucun fichier de l'arbre WebRTC2 vivant, hors deux commentaires.

### Le vrai risque de désynchronisation : les ancres, pas le code

Ce fichier cite une centaine de `fichier:ligne` dans `docs/`. Chaque édition de `securite.md`,
`architecture.md` ou `tests.md` en fait dériver une partie — **silencieusement**, puisqu'un numéro
de ligne faux ne casse rien, il égare.

Deux gestes qui suffisent :

- quand F1 remonte sa doc, **relire ce fichier dans la foulée** : ce que F1 vient d'écrire a pu
  rendre une tâche d'ici sans objet — c'est un gain, pas une perte ;
- ne jamais chercher une annotation par son numéro de ligne seul : le `grep` de son mot-clé est la
  source de vérité, la ligne n'est qu'un raccourci.

---

## Lot 0 — Annotations déjà fausses · sortie B — ✅ TERMINÉ

Les six entrées sont fermées. Ce qu'elles ont appris, et qui vaut pour les lots suivants, est dans
[`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md) : une annotation qui décrit l'état d'une **classe
nommée** se vérifie sur le **câblage** (`artisan event:list`), une annotation qui décrit le
**comportement d'une requête** se vérifie contre un **vrai graphe** et jamais contre la doublure, et
une page de référence peut violer la convention que le paquet énonce ailleurs — ça se trouve au grep.

La dernière fermée est la divergence d'API de `use-reverb-channel.md`, née en corrigeant les imports
de la même page. Les quatre écarts sont corrigés dans la table de référence : les deux verbes de
whisper y figurent, l'optimisme d'`isConnected` hors présence est dit, le couplage entre `autoJoin`
et la réactivité du nom de canal est dit, et `stopListening` annonce qu'il coupe aussi les listeners
statiques — durablement pour un dynamique, temporairement pour un statique.

## Lot 1 — Code mort · sortie B

- [ ] **Migrer les appelants de WebRTC v1 (4 + 1, un migré), puis supprimer `components/WebRTC/`** ·
      effort [L]
      **Découpé en sept lots le 31/08/2026 — le plan est plus bas, après le recensement.**
      **La tâche la plus rentable du paquet en volume de doc.** La v1 morte est annoncée dans
      **7 fichiers de doc**, dont le piège n°1 du `CLAUDE.md` et une ligne du `CLAUDE.md` de *tout
      projet hôte* — parce que deux arbres coexistent avec des fichiers homonymes
      (`MediaBroadcastProvider.vue`) et qu'un symbole trouvé au grep peut venir de la v1.

      **Vérifié : cinq appelants vivants au cadrage, quatre depuis le lot C**, plus un fichier
      désactivé. L'archive de lecture
      `work/webrtc-v1-notes.md` a été supprimée : sa condition de conservation — « le temps de
      vérifier qu'aucun appelant ne subsiste » — était remplie, et le recensement vit désormais
      dans la doc du module, avec la commande qui le recompte.

      | Appelant | Ce qu'il importe |
      |---|---|
      | ~~`System/widgets/AlertComponent.vue`~~ | ✅ **migré le 31/08/2026 (lot C)** — les deux alertes vivent dans `WebRTC2/Widgets/UI/Alerts/` |
      | `AudioRoom/AudioComponent.vue` | `WebRTC/widgets/MediaBroadcastProvider.vue`, `ui/AudioDefaultUserButtonUI.vue` |
      | `Application/ApplicationComponent.vue` | `WebRTC/widgets/DataUserPeerConnection.vue` |
      | `Whiteboard/WhiteboardComponent.vue` | idem |
      | `ClassRoom/ClassRoomComponent.vue` | idem |
      | `AudioRoom/__AudioComponent copy.vue` | `WebRTC/composables/usePeers.js` — fichier déjà désactivé (`__`) |
      | **`Server/Server.vue`** | **`stores/peers.js` seul — jamais `WebRTC/`** · relevé le 31/08/2026 |

      ⚠️ **Le recensement par `grep -rn "WebRTC/"` rate un consommateur, et c'est un défaut de la
      commande, pas du recensement.** `Server/Server.vue` n'importe aucun fichier de `WebRTC/` : il
      importe le **store v1** `stores/peers.js`, dont il lit deux getters (`getIsStreaming`,
      `getIsCapturing`). Or le périmètre annonce la suppression de ce store. Le recompte demande
      donc **deux** greps, `WebRTC/` **et** `stores/peers.js` — ✅ **la commande de
      `docs/modules/webrtc2/INDEX.md` est corrigée depuis le lot C** (31/08), et ce fait y a été
      remonté avec elle plutôt que de rester ici.

      Corollaire sur les trois appelants data : ils prennent aussi `sendData` du store v1 par
      `mapActions(usePeerStore, ['sendData'])`. Leur migration n'est donc pas une substitution de
      balise — elle débranche aussi le store.

      La v1 n'est donc pas « morte en attente de confirmation » : elle est **vivante sous cinq
      composants**, dont un en `defineAsyncComponent`, invisible à une recherche d'`import`
      statique. C'est écrit dans
      [`docs/modules/webrtc2/INDEX.md`](../docs/modules/webrtc2/INDEX.md) — l'annotation qui la
      donnait pour simplement morte sous-estimait le problème, ce qui est pire que de l'ignorer.

      ⚠️ **Le couplage va aussi dans l'AUTRE sens, et ce tableau ne le disait pas** — relevé le
      30/08/2026 en cadrant la tâche 8 des tests. `WebRTC/widgets/ui/AudioDefaultUserButtonUI.vue:13`
      importe `WebRTC2/Widgets/UI/Audio/SpectrumAnalyzer.vue` : un fichier **v2** dont le seul
      consommateur vivant est la **v1**. Ses deux consommateurs WebRTC2 sont commentés — et l'un des
      deux usages commentés est *faux* (`v-bind="audioProps"` passe `{streamData}` à une prop
      `streams: Array required`). Conséquences pour cette tâche : supprimer `components/WebRTC/`
      rend `SpectrumAnalyzer` orphelin, **et c'est le bon moment pour trancher son sort** plutôt que
      de le laisser en v2 sans appelant. Ses deux défauts propres sont classés dans
      [webrtc2-todo.md](webrtc2-todo.md) ; il n'a aucun test, et n'en aura pas (`happy-dom` n'a pas
      d'`AudioContext`).

      Périmètre : **11** fichiers `WebRTC/` (13 au cadrage — le lot C en a sorti deux), le store
      `stores/peers.js` (+ son dossier `stores/peers/`) et ses **six** consommateurs, la migration
      des **quatre** appelants restants vers `WebRTC2/`, et le sort de `SpectrumAnalyzer`.
      Annotation (7 fichiers) : `CLAUDE.md` · `docs/INDEX.md` ·
      `docs/modules/webrtc2/INDEX.md` · `docs/modules/autres-modules.md` ·
      `docs/architecture/package.md` · `docs/modules/chat.md` ·
      `resources/boost/guidelines/core.blade.php` · plus le `CLAUDE.md` de tout projet hôte

      **Deux faits relevés le 31/08/2026 en cadrant la tâche, et qui changent le plan.**

      **1. Il n'y a pas de composant à écrire : `WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue`
      EST le provider data** — `mode` a `'data'` pour défaut, il fait `watchUsers` sur les `users`,
      `initialize(callbacks)` si on lui en passe, et surtout `cleanup()` au démontage, que la v1 ne
      faisait pas. Il a son test. Toute proposition d'un `DataPeerProvider` neuf est de la
      sur-ingénierie : l'exemple d'usage exact est `WebRTC2/Exemples/Home.vue`.

      **2. Mais le contrat du callback n'est PAS mappable 1 pour 1, et c'est là qu'est le travail.**
      En v1, `callbackConnection` reçoit la `DataConnection` **brute** et l'appelant y branche
      lui-même ses `conn.on("data")` / `conn.on("open")`. En v2 c'est le transport qui possède les
      listeners et rappelle `onDataReceived(data, conn, metadata)`
      (`createPeerContext.js`, garde de taille en amont) et `onConnectionOpen(conn)`. Chaque
      appelant se **réécrit** donc.
      ⚠️ **La « bonne nouvelle » écrite ici — « v2 ne parse pas le payload non plus, les `JSON.parse`
      des trois appelants restent valables tels quels » — était FAUSSE, et D0 l'a mesurée le
      01/09/2026.** v1 **sérialise avant d'émettre** (`stores/peers/actions.js`, `safeStringify(message.data)` :
      c'est une **chaîne** qui part sur le fil, d'où le `JSON.parse` de chaque récepteur), alors que
      v2 émet l'**objet** brut (`usePeerTransport.sendData` → `conn.send(data)`) et qu'aucun
      consommateur v2 ne parse quoi que ce soit. Les trois `JSON.parse` doivent donc **disparaître** :
      laissés en place, ils reçoivent un objet et lèvent. La table complète est dans
      [webrtc-data-v1-v2.md](webrtc-data-v1-v2.md).

      ℹ️ Le watch de `users` du provider v2 **n'est pas profond, et c'est un contrat épinglé**
      (`MediaBroadcastProvider.test.js`, « une composition mutée en place n'est pas vue »). Si un
      appelant mute sa liste en place, c'est **l'appelant** qui s'adapte — jamais le provider.
      **A2 a tranché le 01/09/2026 : aucun ne mute, la liste est réaffectée** ⇒ rien à adapter en D,
      ni chez les appelants ni chez le provider. Le détail est dans A2 ci-dessous.

      **Découpage — sept lots, chacun committable et vérifiable seul.**

      Trois règles, qui expliquent l'ordre :

      - **aucun lot ne change un comportement ET ne déplace un fichier** — on corrige en place, on
        prouve, on déplace ensuite : la preuve du déplacement est le même test resté vert ;
      - **on peut s'arrêter après n'importe quel lot** sans laisser l'arbre à moitié migré ;
      - **la suppression est le dernier lot, jamais un effet de bord** — et sa preuve n'est pas
        Vitest : un fichier que plus rien n'importe n'entre dans aucune suite. C'est `npm run build`.

      - [x] **A. Poser le filet — zéro changement de comportement** `[S]` — **lot clos le
            01/09/2026** : A1 (21 cas), A2 (la lecture qui débloque D) et A3 (le filet à la source
            de la présence, 3 cas). Le filet promis est en place aux deux bouts du contrat de
            présence.
            - [x] A1 — **fait le 31/08/2026. Deux fichiers, 21 cas, dont 4 ROUGES refermés par B1
                  sans qu'une ASSERTION change** :
                  `System/__tests__/AlertComponent.test.js` (12 cas, 3 rouges — la branche vocale
                  et l'énumération du vocabulaire) et `System/__tests__/Notifications.alerts.test.js`
                  (9 cas, 1 rouge — le symptôme utilisateur, à l'altitude où c'en est un).
                  Chaque rouge était précédé d'un garde-fou de présence : le message était « le verbe
                  n'est pas atteint », jamais « bouton introuvable ».
                  ⚠️ **La promesse « sans toucher une ligne de test » était trop large, et B1 l'a
                  mesuré** : les assertions n'ont pas bougé, mais **6 titres et les 2 docblocks**
                  portaient l'annotation « rouge jusqu'à B1 » et sont devenus faux à la seconde où
                  le correctif est passé. Une prose de test est une couche du volet doc comme une
                  autre — à énumérer d'avance, comme les autres.
                  **Trois acquis qui servent aux lots suivants :**
                  · **le lot C n'aura AUCUNE ligne de test à modifier** — les deux fichiers
                  n'importent que `AlertComponent` et atteignent les alertes par leur `name` et
                  leur titre rendu, deux identités qu'un `git mv` ne touche pas. Sa preuve
                  annoncée (« sans autre modification que le chemin d'import ») est donc plus
                  forte : seuls les deux `defineAsyncComponent` d'`AlertComponent.vue` changent.
                  · **le second fichier est justifié par la mesure, pas par le rangement** : les
                  huit contrôles de couture de `Notifications.vue` rougissent là-bas et **0 cas**
                  des trois autres fichiers. `.AlertToUser` et `onResponseAlert` n'étaient
                  couverts nulle part.
                  · **`flushPromises` n'est pas un substitut de `dynamicImportSettled`, et la
                  profondeur de la chaîne de modules décide** : au fichier unitaire (un niveau
                  d'asynchrone) il passe, au fichier de couture (deux niveaux) il laisse 2 cas
                  rouges. Mesuré des deux côtés, écrit dans les deux docblocks — ne pas re-mesurer.
            - [x] A2 — **fait le 01/09/2026. Réponse : `users` est REMPLACÉ, jamais muté en
                  place** ⇒ c'est la branche « rien à faire » — **l'appelant ne passe pas de copie et
                  le provider ne bouge pas**. D0 peut s'écrire tel qu'il est cadré.
                  **La question ne se pose pas appelant par appelant, et c'est le vrai résultat de
                  la lecture** : les trois ne possèdent pas leur liste, ils la reçoivent en **prop**.
                  Source unique, et unique par construction — le `<router-view :users="users">` de
                  `Server/Room.vue:23-28`, seul endroit où les trois sont montés (arbre de routes :
                  `Server.vue` → `room/:roomId` = `Room.vue` → `whiteboard` / `classroom` /
                  `application`). `ClassRoom` repasse la **même** référence à `Whiteboard`. Le `grep`
                  des trois noms de composants dans le projet hôte et les autres paquets maison rend
                  **zéro** : aucun montage hors de ce chemin.
                  La liste vient donc d'`useReverbChannel(channelName, { type: 'presence' })`, qui
                  **réaffecte sur ses quatre chemins d'écriture** — `here` (l.128,
                  `users.value = presentUsers`), `joining` (l.148, spread), `leaving` (l.153,
                  `filter`), `leave()` (l.119, `[]`). Aucun `push`/`splice` sur une liste
                  d'utilisateurs dans tout le paquet, hors tests.
                  **Trois faits adjacents, à consommer dans les lots qui les concernent :**
                  · **le `deep: true // keep this` de `DataUserPeerConnection.vue:65` ne garde rien
                  de plus que le superficiel** — rien ne mute un objet `user` en place
                  (`useStatusUsersObserver` écrit dans `applicationStore` par slug, pas dans la
                  liste) : sortie **B** à consommer au lot F, quand le widget disparaît. Ne pas le
                  recopier en v2.
                  · **le garde `if (newVal.length === 0) return` de v1 n'a pas d'équivalent à écrire
                  en v2** : le premier tour à vide est traité par conception et déjà documenté
                  (`useMediaBroadcast.js:143-151` — `getRoomUsersDiff` ne passe `presenceSynced` à
                  `true` que sur un tour qui a OBSERVÉ un membre). Rien à porter en D.
                  · **le contrat « le fournisseur réaffecte » n'était épinglé à AUCUN bout** — d'où
                  A3. Le cas provider (`MediaBroadcastProvider.test.js`, « le watch n'est PAS
                  profond ») tient la moitié consommateur et **son commentaire annonçait déjà
                  l'autre : « l'autre moitié est un item de `work/` »**.
                  Annotation : **aucune couche injectée**, vérifié — les deux occurrences de
                  `core.blade.php` sur `users`/`watch` parlent d'autre chose (`Users::visibleUsers`,
                  le fil d'Ariane) et le `CLAUDE.md` du paquet rend zéro. **Aucun `boost:update`** ;
                  cinquième tâche d'affilée dans cette configuration, après `sfu`, `webrtc2Events`,
                  B1 et B2.
                  - [x] Code — **aucun, par définition** : A2 est une lecture · - [x] Doc — le `ℹ️`
                        du cadrage ci-dessus (la question qu'il posait est tranchée), cet item, et
                        les deux `work/README.md` · - [x] Tests — **aucun dans la lecture**. Ce
                        qu'elle a trouvé à épingler est A3, une tâche à part entière et non un effet
                        de bord
            - [x] A3 — **fait le 01/09/2026, sortie C.** Épingler la réaffectation **à la source**,
                  la moitié que le cas provider ne peut pas tenir. Trois cas dans le `describe`
                  « liste de présence » d'`useReverbChannel.test.js`, un par chemin d'écriture
                  réactif, chacun assérant une **nouvelle référence** — le harnais existait, rien à
                  écrire pour l'accueillir.
                  ⚠️ **Les trois naissent VERTS, et c'est le cas prévu** : ce sont des gardes de
                  non-régression, pas la contre-épreuve d'un défaut. **La règle du paquet ne tombe
                  pas pour autant** — ce qui remplace le rouge de naissance est le **contrôle de
                  harnais**, sans lequel ces trois cas ne valent rien : `here` → `push(...présents)`,
                  `joining` → `push(user)`, `leaving` → `findIndex` + `splice` rougissent **chacune
                  le cas correspondant et lui seul**, et aucune ne fait bouger les six cas de valeur
                  du `describe` — ils assèrent en `toEqual`, qui ne voit pas l'identité. C'est
                  exactement ce qui laissait passer la panne. Référence relue à 24/24 entre chaque
                  mutation, et `git status` contrôlé après restauration.
                  Hors périmètre assumé, écrit dans le docblock : la remise à `[]` de `leave()` —
                  son seul consommateur est le démontage, où le provider part avec le canal.
                  - [x] Code — **aucun** : le composable était déjà correct, c'est un filet
                        · - [x] Doc — **deux mesures devenues fausses à la seconde où les cas sont
                        passés au vert**, toutes deux corrigées en sortie C (l'avertissement
                        remplacé par un nom de test) : le commentaire de
                        `MediaBroadcastProvider.test.js` (« rougit 0 cas sur 1416 », « l'autre moitié
                        est un item de `work/` ») et `docs/modules/webrtc2/tests.md` § « Pousser dans
                        un tableau NU » (« rougit 0 cas sur 1417 »). ⚠️ **Une prose de test est une
                        couche du volet doc** — la leçon de B1, et c'est la deuxième fois qu'elle
                        mord. Le reste de `docs/` attend le lot G, décidé · - [x] Tests — 3 cas,
                        3 mutations mesurées. Suite JS **85 fichiers / 1501 cas, 0 échec**
                        (85 / 1498 avant) ; PHP non rejouée, aucun `.php` touché
      - [ ] **B. Les défauts propres aux deux alertes — indépendants de la migration, livrables
            seuls** `[S]` — B1 et B2 fermés, restent deux 🟢 et un 🟠 (B5) ouvert par le cadrage de B2
            - [x] B1 — **fait le 31/08/2026, sortie A.** `AudioCallAlert` émettait `response-call`
                  quand tout le monde écoute `response-alert` : **zéro écouteur dans le paquet**,
                  donc Accepter et Refuser étaient morts sur un appel VOCAL entrant, et l'auto-refus
                  à 20 s aussi ; l'appelant attendait l'abandon du moteur de retry. Trois lignes
                  (`emits` + les deux `$emit`) ⇒ les 4 rouges de A1 au vert.
                  **La forme était contrainte par un test**, et c'est ce qui rend le lot C possible :
                  un seul vocabulaire pour les deux alertes, pas un second écouteur chez le parent —
                  elles restent interchangeables vues d'`AlertComponent`.
                  ⚠️ **Effet de bord à connaître avant B2 : B1 a ARMÉ le timer d'auto-refus vocal.**
                  Il émettait dans le vide, il émet désormais un vrai refus. Les deux alertes sont
                  donc également exposées au défaut B2, là où une seule l'était.
                  Annotation : **aucune couche de `docs/`** — le 🔴 n'y avait jamais été rustiné, il
                  y était *ignoré* (`docs/modules/webrtc2/flux.md` décrivait la chaîne d'appel
                  entrant comme fonctionnelle pour les deux types, et B1 la rend vraie **sans une
                  ligne d'édition**). Une doc fausse par omission, cas que le chantier ne prévoit
                  pas. En revanche **deux docblocks de test** la portaient. **Aucun `boost:update`
                  requis**, vérifié : ni le `CLAUDE.md` du paquet ni `core.blade.php` ne citaient
                  `response-call` — troisième tâche d'affilée dans cette configuration, après `sfu`
                  et `webrtc2Events` : la frontière est nette, `core.blade.php` ne descend jamais au
                  niveau du widget.
                  - [x] Code — 3 lignes dans `AudioCallAlert.vue` · - [x] Doc — les 2 docblocks
                        (bannières requalifiées en sortie C, l'exemple périmé reformulé sans exemple
                        nommé, la contrainte de forme promue en garde de non-régression, les caveats
                        des contrôles de harnais requalifiés — chiffres **non re-mesurés**, dette
                        nommée pour le lot C : ils ne se convertissent pas en écarts par
                        soustraction) + `webrtc2-todo.md`, les deux `work/README.md` et une ligne de
                        `docs/architecture/tests.md` · - [x] Tests — aucun à écrire, A1 les avait
                        posés : 21/21 verts, **aucune assertion touchée**, 6 titres requalifiés.
                        Suites inchangées par ailleurs — JS 84 fichiers, 0 échec (4 avant) ; PHP 286
                        OK
            - [x] B2 — **fait le 31/08/2026, sortie A + sortie B.** Dans les **deux** alertes, le
                  handle du `setTimeout` d'auto-refus n'était pas stocké — `beforeUnmount` n'annulait
                  que l'`interval` — et `pickedUp` n'était jamais écrit à `true`. Un seul
                  `clearTimeout`, posé sur le chemin commun aux TROIS sorties (accepter, refuser,
                  quitter l'écran), ferme les deux moitiés : l'ensemble des chemins qui auraient posé
                  `pickedUp = true` est exactement celui qui appelle la méthode d'arrêt. `pickedUp`
                  devient donc mort au sens strict ⇒ **supprimé** (sortie B), et `stopDing` est
                  renommé `stopAlert` — y absorber `clearTimeout` sans renommer aurait fabriqué un
                  nom qui ment. Le `ding.pause()` en double du `beforeUnmount` part par construction.
                  ⚠️ **Ne PAS livrer les deux gardes ensemble** : `pickedUp` et `clearTimeout`
                  tiendraient la même propriété par deux mécanismes, et la mutation n° 2 ne
                  rougirait plus que 2 cas au lieu de 5 — le contrôle de harnais mentirait.
                  ⚠️ **Le rouge annoncé ici (« accepter à 5 s n'émet pas de refus à 10 s ») serait né
                  VERT à l'étage de couture**, et c'est ce qui a décidé du fichier : `Notifications`
                  démonte l'alerte en première ligne d'`onResponseAlert`, et Vue 3.5.24 **avale
                  l'émission d'une instance démontée** (`runtime-core.cjs.js:6367`) — VTU supprimant
                  par ailleurs l'historique au démontage. Le cas vit donc à l'étage `AlertComponent`,
                  qui ne démonte jamais l'alerte. **Le `describe` local est écarté**, pour trois
                  raisons dont deux non anticipées : l'`afterEach` d'un `describe` imbriqué tourne
                  AVANT celui du parent, donc `useRealTimers()` passerait avant `unmount()` ; et il
                  aurait fallu réécrire la section « hors périmètre » de `AlertComponent.test.js`,
                  qui déclare ne pas appeler `vi.useFakeTimers()`.
                  Annotation : **aucune couche injectée** — `grep` sur `core.blade.php` et le
                  `CLAUDE.md` du paquet rend zéro, donc **aucun `boost:update`** ; quatrième tâche
                  d'affilée dans cette configuration, après `sfu`, `webrtc2Events` et B1.
                  - [x] Code — ~9 lignes dans chacune des deux alertes, `diff` des deux fichiers
                        **toujours à 4 lignes** (titre, `name:`, 20000/10000) : le lot C est intact
                        · - [x] Doc — une ligne de `docs/modules/webrtc2/flux.md` (l'auto-refus n'y
                        nommait que la branche visio, fausse par omission depuis que B1 a armé la
                        vocale) + les deux docblocks de A1 (les **deux bornes de durée chiffrées
                        partent AVEC leur cause** — le démontage annule désormais le minuteur —,
                        `stopDing` renommé, le commentaire d'`afterEach` requalifié en contrat du
                        composant, `pickedUp` retiré de l'énumération hors-périmètre) + un
                        commentaire de constat sur le voisin non couvert (B5) + `webrtc2-todo.md`
                        (item élagué, B5 posé, la ligne des « deux filets » corrigée) + les deux
                        `work/README.md`. ⚠️ Les 11 + 11 contrôles de harnais de A1 **non
                        re-mesurés** : ce sont des mutations d'`AlertComponent.vue`, que B2 ne touche
                        pas — la dette reste propriété du lot C · - [x] Tests —
                        `AlertComponent.timers.test.js`, **le troisième harnais et le premier montage
                        de composant Vue sous horloge factice du paquet** : 9 cas dont **5 rouges
                        d'abord**, verts au correctif sans qu'une assertion change. 12 mutations
                        mesurées, référence relue à 0 avant chacune. Suites : JS **85 fichiers /
                        1498 cas, 0 échec** (84 / 1489 avant) ; PHP 286 OK
            - [ ] B3 — 🟢 **rien ne garde `mappingComponents[action][type]`** (`AlertComponent.vue:51`,
                  double déréférencement) : un `action` inconnu **lève** au `created()`, un `type`
                  hors `{vocal, visio}` rend silencieusement un écran vide. Relevé en écrivant A1,
                  **délibérément non testé là-bas** : le garde existe une couche plus haut et il est
                  déjà épinglé côté PHP (`/send-alert-to-user` exige
                  `options.action ∈ VALID_INVITE_ACTIONS`, et `ValidationTest` nomme ce
                  déréférencement). Un cas JS aurait été soit un rouge qu'aucun lot ne referme, soit
                  un constat demandant au code de ne jamais être durci. Le `type` inatteignable par
                  les deux alertes est, lui, **couvert** par A1 (cas « n'affiche rien, et ne lève
                  pas »). Décider : garde + repli, ou sortie D datée
            - [ ] B4 — 🟢 **`notificationComponent` est un `ref` qui porte un composant**
                  (`Notifications.vue:68`) : Vue le journalise à chaque montage réel d'alerte
                  (« Vue received a Component that was made a reactive object », `markRaw` /
                  `shallowRef` attendus). Vu pour la première fois en montant l'alerte pour de vrai
                  en A1 — donc présent en production, pas un artefact de test. Une ligne à changer,
                  aucun comportement
            - [ ] B5 — 🟠 **une seconde invitation PATCHE l'alerte vivante au lieu de la remonter**
                  `[S]` — trouvé au cadrage de B2, adjacent et distinct. `Notifications.vue:93`
                  réaffecte le **même objet** composant : ni `AlertComponent.created()` ni le
                  `mounted()` de l'alerte ne rejouent, donc le type d'alerte affiché reste celui de
                  la première invitation, aucun nouveau minuteur d'auto-refus n'est armé, et l'ancien
                  tire sur les `options` du second appelant — qui est refusé au bout du reliquat, son
                  moteur de retry s'arrêtant sur ce refus explicite. `isInviteDuplicate` ne l'attrape
                  pas : elle dédoublonne par `inviteId`, et deux appelants en ont deux.
                  ⚠️ **B2 ne le referme pas** — il n'y a pas de démontage, donc l'annulation du
                  minuteur n'a rien à annuler. B2 en est le **préalable** : sans lui, poser une `key`
                  échangerait le défaut contre une fuite. Et là où B2 était latent (Vue avale
                  l'émission d'une instance démontée), **celui-ci mord aujourd'hui**.
                  Correctif candidat : `key` sur le `<component>` de `Notifications.vue:4-10`, **par
                  compteur monotone et non par `inviteId`**, qui est `nullable` côté serveur — une
                  `key` `undefined` retombe sur le patch. Écarté : un `watch` dans les deux alertes,
                  qui descend une responsabilité du parent dans deux enfants que le lot C déplace.
                  ⚠️ **La question produit se tranche AVANT d'écrire la `key`** : que doit-il se
                  passer quand un second appel arrive pendant une invitation affichée ? La `key`
                  livre « le dernier appelant gagne, proprement » ; l'autre réponse défendable est
                  « occupé ⇒ refus automatique du second ». Ne pas coder la première en croyant
                  qu'elle est neutre. **Rouge d'abord, et il ne demande AUCUN faux timer** : `visio`
                  puis `vocal` sans avoir répondu ⇒ l'écran doit basculer sur `AudioCallAlert`. Cas
                  de couture, donc `Notifications.alerts.test.js`, où le cas « une seconde invitation
                  réaffiche une alerte » porte déjà le commentaire qui dit qu'il ne le couvre pas
                  - [ ] Code · - [ ] Doc · - [ ] Tests
      - [x] **C. Déplacer les deux alertes** `[S]` — **fait le 31/08/2026, sortie B.** `git mv` vers
            `WebRTC2/Widgets/UI/Alerts/` + les deux `defineAsyncComponent` d'`AlertComponent`. Elles
            étaient v1 **par leur chemin, pas par leurs dépendances** : elles n'importent que
            `IconWidget` (par alias, donc insensible au chemin) et leur consommateur était déjà
            branché sur la v2 (`Notifications.onResponseAlert` → `peers.acceptCallFromPeer`).
            La preuve annoncée a tenu **exactement** : `git status` montre trois entrées — deux
            renommages (`R`) et **une seule ligne modifiée ailleurs**, la paire d'imports
            d'`AlertComponent.vue`. Zéro fichier de test touché, suite JS **85 fichiers / 1498 cas,
            0 échec** — identique à la baseline de B2 — et `npm run build` vert, seul contrôle qui
            voie la résolution Rollup d'un import dynamique.
            ℹ️ **Ce que le lot a coûté en plus de son diff : trois lignes de doc devenues fausses au
            même instant**, toutes des *comptes* — les appelants v1 passent de cinq à quatre, les
            fichiers de `WebRTC/` de 13 à 11, et `Widgets/UI/` gagne un sous-dossier. Le
            déplacement le plus mécanique du chantier avait quand même un volet doc : un lot qui ne
            change aucun comportement peut périmer un décompte, et un décompte est une annotation
            comme une autre.
            - [x] Code — 2 `git mv` + 2 lignes ; `WebRTC/widgets/partials/` disparaît, vide
            - [x] Doc — `docs/modules/webrtc2/INDEX.md` (le compte, l'arborescence, **et** la
                  commande de recompte, corrigée ici au lieu du lot G) et
                  `docs/modules/webrtc2/api.md` (l'inventaire `Widgets/UI/` omettait deux widgets du
                  module). **Aucun `boost:update` requis**, vérifié : ni le `CLAUDE.md` du paquet ni
                  `core.blade.php` ne contiennent la chaîne `alert` — même configuration que `sfu`
                  et `EventBus`
            - [x] Tests — **aucun**, et c'est le contrat du lot : les trois fichiers d'alerte
                  atteignent les composants par leur `name` d'option et leur titre rendu, deux
                  identités qu'un `git mv` ne touche pas. Un rouge chez eux aurait dit « chemin
                  d'import faux », rien d'autre
      - [ ] **D. Le canal data, un module à la fois** `[L]`
            - [x] D0 — **fait le 01/09/2026.** La correspondance est écrite une fois, et **partagée
                  en deux** : le contrat v2 — signatures des quatre callbacks,
                  `sendData(data, destUserSlugs)`, les quatre cas où `onDataReceived` n'arrive pas ou
                  arrive en **arité 1** — est allé dans `docs/modules/webrtc2/api.md`, qui n'en
                  listait que les **clés** ; le delta v1→v2 et les spécificités des trois modules dans
                  [webrtc-data-v1-v2.md](webrtc-data-v1-v2.md), qui **pointe** `api.md` au lieu de le
                  recopier et porte sa condition de suppression en tête (il part avec la v1, au lot
                  F/G — précédent : `webrtc-v1-notes.md`).
                  **La lecture a rapporté plus que la table**, et c'est le résultat du lot :
                  · **une ligne du cadrage était fausse** — les `JSON.parse` (⚠️ ci-dessus), corrigée
                  à sa source plutôt que contournée ;
                  · **l'avertissement d'`api.md` sur `callbacks` était faux aussi**, et sur un piège
                  vécu : « passer `callbacks`
                  **et** initialiser dans l'enfant initialiserait deux fois ». Non — le stockage est
                  **write-once par clé**, le second jeu est **perdu en silence** et les callbacks de
                  l'enfant ne prennent jamais effet. `usePeerOrchestrator.callbacks.test.js` le disait
                  déjà mot pour mot ; l'avertissement porte désormais le nom de son test ;
                  · **`exclude` n'a AUCUN équivalent v2** (`destUserSlugs` ne rend qu'`include`) : un
                  message v1 portant `include` passerait en v2 comme un champ de payload, **sans
                  filtrer personne et sans erreur**. Application en est le seul consommateur ⇒ point
                  ouvert rattaché à **D2**, pas au lot D en général.
                  ℹ️ **L'écart de sérialisation est la seule affirmation structurante que rien
                  n'épingle** : `usePeerTransport.mesh.test.js` tient bien l'absence de transformation
                  à l'émission, mais tous ses cas passent une chaîne ou un `ArrayBuffer`, jamais un
                  objet. Écrit comme tel dans le fichier de delta.
                  - [x] Code — **aucun, par définition** : D0 est une écriture, comme A2
                  - [x] Doc — les cinq couches, énumérées d'avance : `docs/modules/webrtc2/api.md`
                        (substance + la correction) · `work/webrtc-data-v1-v2.md` (neuf) · cet item et
                        le ⚠️ du cadrage · `work/README.md` du paquet · le `work/README.md` de l'hôte.
                        **Aucun `boost:update`** — vérifié : `sendData`, `callbacks`, `onData` et
                        `initialize` rendent **zéro** sur le `CLAUDE.md` du paquet **et** sur
                        `core.blade.php`. Sixième tâche d'affilée dans cette configuration, après
                        `sfu`, `webrtc2Events`, B1, B2 et A2
                  - [x] Tests — **aucun**, volet code vide. Ce qui remplace le rouge de naissance :
                        chaque affirmation du contrat v2 nomme le test qui l'épingle, ou dit qu'aucun
                        ne le tient (le cas de la sérialisation, ci-dessus)
            - [ ] D1 — **Whiteboard**, le plus facile à prouver. Vérif : deux navigateurs, un trait
                  tracé chez A apparaît chez B, le pointeur distant bouge
            - [ ] D2 — **Application**. Vérif : l'iframe reçoit `connectionEnabled` puis les messages
            - [ ] D3 — **ClassRoom**, en dernier : il imbrique Whiteboard, donc deux providers, donc
                  deux contextes sur le Peer singleton (couvert par `scenarios/multiContext.test.js`).
                  Vérif : bascules whiteboard / chat propagées entre deux navigateurs, **avec** D1
                  déjà migré dessous
      - [ ] **E. AudioRoom** `[M]`
            - [ ] E1 — `AudioComponent` importe le `MediaBroadcastProvider` **v1** : l'homonyme en
                  action. Comparer les deux contrats de slot avant de substituer (v2 :
                  `v-slot="webrtc"`, api sous la clé `api`). Le module est atteignable par une vraie
                  route (`routes/application.js`) et déclaré dans `Server/roomSettings.js` — ce n'est
                  pas du code mort, la vérification manuelle est obligatoire
            - [ ] E2 — trancher `SpectrumAnalyzer` : rebranché sur un consommateur v2, ou supprimé.
                  **Décision datée** (sortie D) ; il n'a aucun test et n'en aura pas — `happy-dom`
                  n'a pas d'`AudioContext`
      - [ ] **F. La suppression** `[M]`
            - [ ] F1 — `Server/Server.vue` : migrer `getIsStreaming` / `getIsCapturing` du store v1
                  vers `peers2` (vérifier d'abord qu'il les expose ; sinon, l'ajouter est le
                  préalable)
            - [ ] F2 — supprimer `components/WebRTC/`, `stores/peers.js` et `stores/peers/`.
                  Preuve : les **deux** greps rendent zéro · suite JS verte · **`npm run build`**,
                  seul contrôle qui voie un import cassé dans un fichier qu'aucun test n'importe
      - [ ] **G. La doc, en dernier** `[M]` — les 7 fichiers listés plus haut, dans l'ordre imposé
            par [le `work/` du projet hôte](../../../../work/README.md), puis `boost:update`, puis
            `grep 'laravel-socializer/core rules ===' CLAUDE.md`. **Une** correction à y porter au
            passage : la doc annonce **un** homonyme alors qu'il y en a deux —
            `composables/useMediaBroadcast.js` (v1) / `Composables/useMediaBroadcast.js` (v2), qui ne
            diffèrent que par la casse du dossier. *(La seconde — la commande de recompte à deux
            greps — a été faite au lot C, dans le paragraphe qu'il réécrivait de toute façon.)*

      **Les trois volets du gabarit, répartis** : *code* = B → F · *tests* = A et B, plus les
      vérifications manuelles nommées de D et E (aucun des appelants restants n'a de test, et aucun
      n'en recevra : ce sont des composants métier hors du filet — la vérification à deux navigateurs
      les remplace, et elle est nommée lot par lot) · *doc* = G, **plus les décomptes que chaque lot
      périme au passage** — le lot C l'a montré, et le gabarit ne l'annonçait pas.
      **Chemin critique** : A → B → C sont livrables tout de suite et indépendants du reste ; F ne
      part pas avant que D et E soient prouvés à la main.
      **État au 01/09/2026** : **le lot A est CLOS** (A1, A2, A3), **B1, B2 et C sont faits**, et
      **D0 est fait** — la table de traduction existe, elle est dans
      [webrtc-data-v1-v2.md](webrtc-data-v1-v2.md) et le contrat v2 qu'elle a mis au jour est dans
      `docs/modules/webrtc2/api.md`. A2 avait levé la dernière inconnue du canal data — la liste de
      présence est **réaffectée**, donc **ni l'appelant ni le provider n'ont à s'adapter en D**.
      **La suite est D1**, Whiteboard, le plus facile à prouver à deux navigateurs — et le seul des
      trois à imbriquer `on("data")` dans `on("open")`. B5 reste ouvert en parallèle, sans
      dépendance : il ferme un 🟠 qui mord aujourd'hui, mais demande de trancher une question produit
      avant d'écrire la `key`.
      ⚠️ **Ce que A2, A3 et D0 ajoutent au gabarit** : une tâche **sans volet code** peut avoir le
      volet doc le plus lourd du lot. A2 n'a touché aucun fichier de code et a réécrit quatre
      endroits ; A3 n'a écrit que du test et a **périmé deux mesures** — dont une dans `docs/` ;
      **D0 n'a écrit que de la prose et a retourné deux affirmations fausses**, une dans ce fichier et
      une dans `docs/`. Le lot C avait montré qu'un décompte est une annotation ; A3 y a ajouté la
      **mesure de contrôle à 0** ; D0 y ajoute la **« bonne nouvelle »** — une phrase qui dit qu'il
      n'y a rien à faire est la plus coûteuse des annotations fausses, parce qu'elle est écrite pour
      être crue sans être revérifiée. Les chercher dès qu'un lot lit du code.

- [x] **Supprimer `WebRTC2/EventBus/webrtc2Events.js`** · effort [S] — **fermé le 31/08/2026,
  sortie B.**

  La question « le brancher (A) ou le supprimer (B) » avait été réglée par le fait, pas par un
  arbitrage de goût : **la seule fonction du module qui valait quelque chose, `normalizeType`, avait
  déjà été récupérée** dans `Composables/utils/validators.js` sous le nom `normalizeDirectCallType` —
  le prédicat « les deux types d'un appel direct » qui manquait au paquet, et dont l'absence
  fabriquait un cul-de-sac (`isValidCallType` acceptant `screen`). Le reste du module normalisait un
  payload à six champs que personne n'émet, les tests des boutons d'appel épinglant la **forme
  brute** des deux côtés : le brancher aurait demandé de changer quatre émetteurs pour gagner zéro
  fait.
      Annotation : `docs/modules/webrtc2/api.md` — **remplacée**, pas supprimée : le bloc ⚠️ portait
      aussi deux faits qui ne sont pas des rustines (les appelants émettent en forme brute ; le type
      est normalisé par `normalizeDirectCallType`), et le second n'était documenté nulle part dans
      `docs/`. La ligne qui remplace l'avertissement est un contrat — et elle a corrigé au passage un
      énoncé faux : la normalisation a lieu **aux deux bouts**, pas seulement à la réception.
      - [x] Code — `EventBus/` disparaît (186 lignes) ; deux commentaires de `validators.js`
            requalifiés — le module y reste nommé **comme supprimé**, pour que l'argument « le type
            `'audio'` était mort » reste vérifiable dans `git log` au lieu d'égarer
      - [x] Doc — `api.md` (remplacée) et `INDEX.md` (ligne d'arborescence retirée). **Aucun
            `boost:update` requis**, vérifié : ni le `CLAUDE.md` du paquet ni `core.blade.php` ne
            citaient `EventBus` — même configuration que la tâche `sfu`
      - [x] Tests — aucun test à écrire : rien à épingler dans la suppression d'un module que
            personne n'importe, et un test neuf ici serait vert par vacuité. Contrôle : suite JS
            **82 fichiers / 1468 tests, inchangée** avant et après

- [ ] **Vider les cinq poches mortes restantes** · effort [M]
      `docs/architecture/package.md` liste une section « Zones mortes connues » dont
      l'objet est « à savoir pour ne pas y chercher quelque chose ». Une section entière de doc pour
      compenser du code qu'il suffit de supprimer. **Vérifié**, restent vraies :

      | Zone | État |
      |---|---|
      | `src/routes/socializer/admin.php` | groupe de route vide, 6 lignes commentées |
      | `src/routes/socializer/console.php` | 16 lignes de docblock, zéro commande |
      | `src/config/socializer.php` | `table_names` vide |
      | `SocializerUpgrade` | 27 lignes non commentées sur 67 — commande enregistrée, inerte |
      | `__StreamUserButton.vue`, `__CaptureUserButton.vue`, `__AudioComponent copy.vue` | désactivés par convention `__` |

      ⚠️ `__AudioComponent copy.vue` porte « copy » dans son nom **et** un espace : à supprimer, pas
      à renommer.
      - [ ] Code — supprimer ou implémenter, poche par poche
      - [ ] Doc — la section « Zones mortes connues » disparaît à mesure ; la supprimer quand elle
            est vide
      - [ ] Tests — `artisan route:list` et `artisan list` inchangés ; suite JS verte

- [x] **Retirer `sfu` de `options.topology`** · effort [S] — **fermé le 30/08/2026, sortie A.**
      La valeur est refusée à la construction (`createPeerContext` lève), et `sfu` reste nommé dans
      la doc et le code comme **réservé, non implémenté** plutôt qu'effacé : le supprimer aurait
      retiré au lecteur du code le seul signal que la question avait été instruite, alors que la
      sortie D du 29/08 tient justement la porte ouverte pour une v2.
      Annotation : `docs/modules/webrtc2/api.md` — **remplacée**, pas supprimée (sortie C sur le
      volet doc : la ligne nomme le test qui épingle le refus).
      - [x] Code — `IMPLEMENTED_TOPOLOGIES` / `RESERVED_TOPOLOGIES` + garde en tête de fabrique
      - [x] Doc — `api.md` et `INDEX.md` (aucune autre couche ne citait `sfu` : ni le `CLAUDE.md`
            du paquet, ni `core.blade.php`, donc **aucun `boost:update` requis**)
      - [x] Tests — 5 cas neufs dans `createPeerContext.test.js`, rouges d'abord ; contre-épreuves
            mesurées garde par garde (3 cas / 1 cas) ; 3 tests requalifiés qui épinglaient les
            états morts comme voulus

## Lot 3 — Noms qui mentent · sortie A

Le motif le plus dense du paquet. Un nom juste supprime son paragraphe d'explication — et, ici,
plusieurs de ces noms ont **déjà coûté des régressions**.

- [ ] **`remoteStreams` exclut les partages d'écran** · effort [M]
      « Consommer `remoteStreams` seul rend tout partage d'écran **invisible** »
      (`createPeerContext.js`). Le nom promet tous les flux distants alors que son jumeau
      `remoteScreens` existe et ne contient que les écrans. Conséquence côté tests : « asserter sur
      `remoteStreams` seul laisse passer toute régression d'écran » — le nom pourrit donc aussi le
      harnais.
      Renommer en `remoteCallStreams`, qui met les deux noms en symétrie
      (`remoteCallStreams` / `remoteScreens`) au lieu de laisser croire à un ensemble et son
      sous-ensemble. API publique du contexte : prévoir un alias de transition.
      Annotation : `docs/modules/webrtc2/api.md` · `docs/modules/webrtc2/tests.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`type` vs `connectionType`** · effort [M]
      « C'est le piège n°1 … **il a coûté deux régressions** » : les confondre envoie la réponse
      dans une file que personne n'observe. Deux champs quasi-homonymes dans le même payload, plus
      un repli `connectionType` absent ⇒ `type` pour rétrocompatibilité avec un backend non déployé.
      Sortie A si le repli peut être retiré (le backend est déployé partout ?) ; sinon C, avec un
      test qui épingle le repli et une doc réduite à une ligne.
      Annotation : `docs/INDEX.md` · `docs/architecture/signalisation.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`metadata.from` / `fromName` portent *mon* identité sur une connexion sortante** · effort [M]
      « Filtrer sur `metadata.from` **ne matche donc rien** côté initiateur » ; et afficher le nom du
      distant « demanderait un champ `fromUserName` dans les événements de `UserController` ».
      Le nom du champ ment sur son contenu selon le sens de la connexion — c'est-à-dire la moitié du
      temps. Renommer (`localFrom`) ou ajouter le champ manquant côté backend.
      Annotation : `docs/modules/webrtc2/api.md` · `docs/modules/webrtc2/architecture.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`canJoinRoom` / `canJoinServer` ne sont pas des prédicats d'appartenance** · effort [L]
      « Sur une room publique la requête renvoie une ligne dès qu'un membre quelconque existe :
      **`true` pour tout le monde**. (Effet miroir : une room publique **vide** renvoie `false`,
      même à son propriétaire.) » Le nom ment dans les deux sens, sur un prédicat de sécurité.
      ✅ **E4.1 livrée le 21/08** : le comportement est corrigé et les gardes refusent par défaut,
      donc le renommage est débloqué et ne porte plus que sur ces deux méthodes —
      `canJoinchatRoom`, elle, exige désormais l'appartenance et son nom est juste.
      Annotation : `docs/modules/webrtc2/securite.md`, piège 1 (« ne sont pas des prédicats
      d'appartenance ») · `docs/architecture/signalisation.md`, note sous le tableau des canaux ·
      `docs/architecture/package.md`, liste des gardes · `Socializable.php`, en-tête
      `GARDES DE CANAL REVERB` + en-tête `GARDE DE RELATION`   (4 couches)
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`socializer:build` est l'installateur, pas un bundler** · effort [S]
      « **Ce n'est pas du bundling — c'est l'installateur** » : une série de `replaceInFile()` qui
      patchent les fichiers du projet hôte. Un commentaire d'en-tête et une ligne de `--help`
      suffisent à retirer le paragraphe.
      Lié : la garde et l'idempotence de ces patchs sont une tâche du socle
      (`vendor/innovation/laravel-estarter/work/doc-rustines.md`, lot 2) — ce paquet en hérite,
      **ne pas la dupliquer ici**. Les `putInFile` sur `.env`
      de `SocializerInstall.php` sont le principal bénéficiaire.
      Annotation : `docs/architecture/package.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`ACCESORS` *(sic)*** · effort [S]
      Faute de frappe figée dans les squelettes de modèles (`Post.php`, `Page.php`,
      `DynAnswerMongo.php`), que `docs/architecture/conventions.md` entérine avec un « *(sic)* »
      au lieu de la corriger. C'est un commentaire de section : aucun risque.
      - [ ] Code · - [ ] Doc · - [ ] Tests — sans objet

- [ ] **Casse de `widgets/` incohérente** · effort [S]
      9 dossiers en minuscule, 2 en majuscule (`Users/Widgets/`, `WebRTC2/Widgets/`) —
      `conventions.md` et `autres-modules.md` le signalent chacun de leur côté.
      Uniformiser ; impacte les imports front.
      - [ ] Code · - [ ] Doc · - [ ] Tests — suite JS verte

- [x] **`Feed.vue` encore en Options API** — migré en `<script setup>`, sur le modèle de
      `Chat/ChatComponent.vue`. Les options ont été vidées **dans** le `setup()` existant, sans le
      défaire : le whisper `leave-feed` reste enregistré AVANT l'appel à `useReverbChannel`, le
      `watch(feedId)` reste SOUS les deux appels, et `resetFeed()` est passé en `onUnmounted`
      (position de dernier qu'il tenait en Options API).
      - [x] Code · - [x] Doc — les trois mentions « Feed.vue en Options API » sont retirées de
      `conventions.md`, `autres-modules.md` et `use-reverb-channel.md`, la règle qu'elles portaient
      étant reformulée sans exemple nommé · - [x] Tests — `components/Feed/__tests__/feedLifecycle.test.js`
      (13 cas) épingle le câblage : ordre de démontage (whisper `leave-feed` → `leave()` → reset),
      join du canal avant le chargement des posts, routage des quatre listeners Reverb vers les
      actions du store, `feed-loaded`, et `feedId` porté par les actions de la liste. Les quatre
      invariants ont été vérifiés par mutation — chacun casse son test et seulement le sien.
      La doublure d'`Echo` est passée en helper partagé
      (`System/composables/__tests__/helpers/createEchoDouble.js`) plutôt que dupliquée, et la
      docstring de `mountOptionsApiLeaver` dans `useReverbChannel.test.js` ne cite plus `Feed.vue`
      (ce test monte un composant synthétique et reste un garde valide pour tout composant non migré).

- [ ] **Le `PublishButton` téléporté d'une room recevait `feedId: null`** · effort [S] — **à
      vérifier à l'écran**
      L'`emit('feed-loaded')` de `Feed.vue` était **commenté** alors que `User/Wall.vue` et
      `WallRoom/WallComponent.vue` branchent tous deux `@feed-loaded` : le `onFeedLoaded` de
      `WallComponent.vue` ne partait jamais, donc son `PublishButton` téléporté dans
      `#room-header-tools` gardait `feedId: null` / `feedFormId: null`. L'emit a été réactivé
      pendant la migration ci-dessus. `Wall.vue` était indemne — son `feedOptions` et son `loaded`
      ne sont lus par rien.
      - [ ] Ouvrir une room, onglet mur, et publier depuis le bouton de l'en-tête.

- [x] **Directives de resize : le suffixe décrit la poignée, pas l'axe** — fait par `989b360`
      (`resizable_height.js` / `resizable_width.js`, épinglé par
      `directives/__tests__/resizableNaming.test.js`).

- [x] **`usersInRoom`** — **fermé le 28/08/2026** : renommé en `connection.remotePeers`, partout
      y compris sur la surface publique. Le récit et les trois écarts avec l'énoncé sont dans
      [webrtc2-todo.md](webrtc2-todo.md) — **ne pas dupliquer ici.**

## Lot 4 — Épingler par un test · sortie C

Ces comportements sont **voulus**. Le paquet a un filet : c'est le seul endroit du chantier où la
sortie C est immédiatement disponible, et elle vide beaucoup de doc.

- [ ] **Le routage des signaux ne pose aucune précondition** · effort [M]
      « C'est un invariant, **pas un oubli**. En ajouter une a déjà fait disparaître des flux » —
      cassé une fois par un `await ctx.waitForMeReady()` et un `if (ctx.isShuttingDown.value)
      return`, de façon intermittente. Le code *ressemble* à une garde manquante : c'est exactement
      ce qu'un relecteur « corrige ».
      Un test nommé `routing_does_not_gate_on_readiness` le protège mieux que trois paragraphes.
      Annotation : `docs/INDEX.md` · `docs/modules/webrtc2/architecture.md`
      - [ ] Code — sans objet · - [ ] Doc — trois paragraphes → une ligne · - [ ] Tests

- [ ] **`setLocalPeer` : async donc toujours truthy, et `undefined` même en succès** · effort [S]
      « Un `if (!ready) return` est **au mieux mort, au pire inversé** ». Deux tests le disent : un
      sur la valeur de retour, un sur le fait qu'aucun appelant ne la lit.
      Annotation : `docs/modules/webrtc2/architecture.md` · `docs/modules/webrtc2/flux.md`
      (le fait est déjà écrit **deux fois** — la sortie C en supprime une)
      - [ ] Code — sans objet · - [ ] Doc · - [ ] Tests

- [ ] **`connectToPeer` : `false` pour différer, `true` pour abandonner** · effort [S]
      Sémantique booléenne inversée par rapport à l'intuition : `true` signifie « pas d'erreur » et
      **annule** le retry — « plus aucune connexion ne se rétablit, silencieusement ».
      Sortie A envisageable (une énumération `RETRY` / `ABORT` au lieu d'un booléen) — à arbitrer.
      Annotation : `docs/modules/webrtc2/architecture.md` · `securite.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`hasOpenConnection` ≠ `isConnectionEstablished`** · effort [M]
      « Les confondre a coûté une **panne définitive** » : un `peer.call()` jamais répondu laisse le
      `RTCPeerConnection` en `connecting` à vie — WebRTC ne bascule pas en `failed`, et PeerJS ne
      notifie pas le `close()` d'un appel non répondu. Résultat : écran noir chez le récepteur,
      **aucune erreur nulle part**.
      Le défaut est dans la lib tierce (sortie D pour la cause), mais les deux prédicats sont à nous :
      un test par prédicat, plus des noms plus contrastés, remplacent la section entière.
      Annotation : `docs/modules/webrtc2/architecture.md`
      - [ ] Code — renommer · - [ ] Doc · - [ ] Tests

- [ ] **`setTimeout(1000)` de `useStickyScroll`** · effort [S]
      Compense le chargement asynchrone des images ; « les simplifier réintroduit des sauts de
      scroll ». Cas d'école du « piège à ne PAS optimiser » — et cas d'école de sortie C.
      Annotation : `docs/modules/chat.md`
      - [ ] Code — sans objet · - [ ] Doc · - [ ] Tests

- [ ] **Les getters Pinia sont auto-déballés** · effort [S]
      « Un mock qui enveloppe un getter dans un `computed()` casse **silencieusement** » →
      `hasOpenConnection` renverrait **toujours `false`**, faux négatif muet. Le harnais a déjà
      produit cette panne.
      Sortie C au niveau du **harnais** : un test de conformité du mock (le paquet en a déjà un,
      `mockFidelity.test.js` — l'étendre plutôt que documenter).
      Annotation : `docs/architecture/conventions.md` · `docs/modules/webrtc2/tests.md`
      - [ ] Code — étendre `mockFidelity.test.js` · - [ ] Doc · - [ ] Tests

- [ ] **Les 9 « pièges de mock »** · effort [M]
      `docs/modules/webrtc2/tests.md` énumère neuf façons dont le harnais peut verdir pour
      la mauvaise raison (`_pushSignal` écrivant dans une structure que `getQueueForRoom` ne lit
      pas ; `handleRemoteDeparture` qui avale ses exceptions ; `setLocalPeer` mocké en
      `vi.fn(() => true)` fabriquant un booléen que la production ne produit jamais — « deux tests
      validaient ainsi une branche inexistante »).
      **Chacun de ces neuf pièges devrait être un test de conformité du mock, pas une puce de doc.**
      C'est la plus grosse conversion C du paquet : neuf assertions contre 33 lignes d'avertissement.
      - [ ] Code — étendre le test de conformité · - [ ] Doc · - [ ] Tests

- [ ] **`json_encode` échappe les `/`** · effort [S]
      Le sérialiseur transforme l'aiguille : l'assertion de non-fuite de chemin « a cessé de garder
      quoi que ce soit **sans virer au rouge** ». Un test mort et indétectable, trouvé seulement en
      contre-épreuve. À épingler par une contre-épreuve permanente, pas par un paragraphe.
      Annotation : `docs/architecture/tests.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

## Lot 5 — À arbitrer, et assumés · sortie D

Trois entrées fermées en sortie D par la clôture du chantier sécurité : la faille résiduelle du
chemin (a) et l'usurpation intra-room sont des **bornes assumées** inscrites dans
[« Bornes non fermées »](../docs/modules/webrtc2/securite.md#bornes-non-fermées-connues) ; les
écritures muettes du graphe sont devenues les trois régimes de la couture, avec leurs deux
arbitrages datés.

- [ ] **`destroy()` de PeerJS émet `disconnected` avant de poser `_destroyed`** — bug de dépendance
      tierce, vérifié dans `peerjs@1.5.4` (l.1810 avant l.1781). Trois gardes empilées le
      compensent. Sortie D : décision datée, plus un test de conformité du mock (déjà partiellement
      là). Un rapport amont serait la seule sortie A.
      Annotation : `docs/modules/webrtc2/architecture.md`

- [ ] **`contextRegistry` en portée module** — « c'est lui qui justifie encore le
      `vi.resetModules()` ». Dette assumée, mais elle contamine le harnais de tous les tests
      multi-pairs. Lié au `[L]` **gelé** de [webrtc2-todo.md](webrtc2-todo.md) : ne pas le dégeler
      ici.

- [ ] **Le graphe NebulaGraph est un réplica, pas une source de vérité** — *entrée réécrite le
      18/08 : son motif d'origine (« le listener du socle est commenté ») était faux, cf. lot 0.*
      Ce qui reste à assumer ou corriger : le réplica **est** synchronisé à l'attachement et au
      détachement, mais `group_user` porte `onDelete('cascade')` — supprimer un groupe ou un compte
      retire les lignes sans événement Eloquent et **laisse l'arête**. Un garde qui lit le graphe
      accorde alors un accès révoqué. **Arbitré et clos le 24/08** : les gardes ont **cessé de lire**
      l'appartenance dans le graphe plutôt que de le re-synchroniser — décision et raison dans
      [`securite.md`, piège 2](../docs/modules/webrtc2/securite.md#deux-pièges-du-graphe-que-ce-garde-contourne).
      Ce qui reste sous cette entrée n'est plus un sujet de sécurité mais de **données** :
      `Socializable::servers()`, `Server::getServers` et le compteur `nb_users` lisent encore
      `registered_in`.
      Annotation : `docs/modules/webrtc2/securite.md` (piège 2) ·
      `src/app/Helpers/ModelTraits/Socializable.php` (docblock de `sharesGroupWith`)

- [ ] **Deux listeners homonymes sur `GroupUserCreated`** — celui du socle est un `handle()`
      entièrement commenté, celui de ce paquet fait le travail. Deux avertissements ⚠️ existent
      **ici** uniquement pour empêcher la confusion que ce code mort provoque (elle a déjà coûté
      une tâche 🟠 fausse). ⚠️ **Le code mort est dans un autre paquet** : la tâche appartient au
      socle — [`vendor/innovation/laravel-estarter/work/doc-rustines.md`](../../../innovation/laravel-estarter/work/doc-rustines.md),
      lot 1. La signaler ici, la traiter là-bas ; les deux annotations tombent quand elle est faite.
      **Troisième copie retirée le 21/08** en condensant le docblock de `sharesGroupWith` ; restent
      `securite.md` et ce docblock, une ligne chacun.
      Annotation : `docs/modules/webrtc2/securite.md` (⚠️ après le piège 2) ·
      `src/app/Helpers/ModelTraits/Socializable.php` (docblock de `sharesGroupWith`)

- [ ] **Namespaces PSR-4 en casse mixte** (`Dauvray\Socializer\app\Models\Post`) et **`src/app/console/`
      en minuscule** alors que le namespace est `…\app\Console\…` — cette dernière est une
      **violation PSR-4 réelle** qui impose un `composer dump-autoload` à chaque nouvelle classe
      autochargée. Renommer le dossier casse les consommateurs ; ne pas le renommer coûte un piège
      permanent. Décision à écrire.
      Annotation : `CLAUDE.md` · `docs/architecture/conventions.md` ·
      `resources/boost/guidelines/core.blade.php`

- [ ] **Front en français en dur** (6 `$t()` dans tout le paquet), et
      `src/resources/lang/fr/network.php` mélangeant libellés d'UI **et slugs de routes traduits**.
      « Un chantier à part entière » — donc une décision datée, pas un avertissement récurrent dans
      trois fichiers.
      Annotation : `CLAUDE.md` · `docs/architecture/conventions.md` ·
      `resources/boost/guidelines/core.blade.php`

- [ ] **Pas de `package.json` dans le paquet** (tout l'outillage front vit chez l'hôte) — répété
      dans 4 fichiers. Structurel et voulu : une décision écrite une fois, et un pointeur depuis les
      trois autres.
      Annotation : `CLAUDE.md` · `docs/INDEX.md` · `docs/architecture/tests.md` ·
      `resources/boost/guidelines/core.blade.php`

- [ ] **Dépendances implicites non déclarées** (`Dauvray\Estarter\*`, Backpack, mongodb,
      formdesigner) — « pas dans le `composer.json` mais requises », parce que les déclarer mettrait
      une URL interne dans le manifeste d'un paquet publié sur GitHub public. Contrainte réelle :
      décision datée, avec la liste maintenue à un seul endroit.
      Annotation : `docs/architecture/package.md` · `docs/architecture/tests.md`

- [ ] **`FakeNebulaGraph` fait du `str_contains`, il ne parse pas le nGQL** — « une requête
      syntaxiquement invalide passe au vert ». Doublure qui ment par construction ; la remplacer est
      un chantier. Décision datée, et le dire **dans le harnais** (un commentaire à l'endroit du
      `str_contains`) plutôt que dans deux fichiers de doc.
      Annotation : `docs/architecture/tests.md` · `docs/modules/webrtc2/securite.md`

- [x] **Trous de couverture** — **fermé en clôturant le plan de tests WebRTC2.** La citation
      (« **Rien** pour Feed, Comment, Server, User, System… ») était devenue **fausse sur quatre
      modules** : Feed, Server, User et System ont un filet. C'était exactement le mode de panne
      annoncé — une liste d'absences se périme sans virer au rouge.
      `docs/architecture/tests.md` dit désormais **où il y a un filet, pas combien**, avec la
      commande qui recense les fichiers ; ce qui reste réellement à découvert y tient en une ligne.
