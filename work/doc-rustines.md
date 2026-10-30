# Dé-rustiner la doc — volet socializer

> **Chantier ouvert — lots 0 et 1 terminés, à une tâche près.** Objectif : que `docs/`, `CLAUDE.md` et
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

> ⚠️ **Ne pas dupliquer les autres chantiers.** Plusieurs rustines de la doc y sont déjà
> cadrées, avec leur analyse : [webrtc2-todo.md](webrtc2-todo.md) et
> [sass-todo.md](sass-todo.md) (thème sombre, `@extend`). Ce fichier y **renvoie** — une règle, un
> seul endroit.

---

## Ordre vis-à-vis du module WebRTC2

**Plus aucune collision ouverte au 30/10/2026.** Le chantier de sécurité (25/08), le plan de tests
et la migration WebRTC v1 → v2 (lot 1, close le 26/10) sont clos ; le durable de chacun est dans
`docs/`.

Faisable en parallèle sans aucun risque, parce que hors de l'arbre WebRTC2 : `ACCESORS`, la casse de
`Widgets/`, et les poches mortes du lot 1.

---

## Lot 1 — Code mort · sortie B

La migration des appelants de WebRTC v1 est **close le 26/10/2026** : la v1 n'est plus ni dans
l'arbre ni dans la doc, et `EventBus/webrtc2Events.js` est supprimé. Ses sept lots, **A → G**,
restent cités comme origine d'items dans d'autres fichiers de `work/` : leur récit se retrouve par
`git log --grep 'lot D'` (même motif pour chaque lettre), leur durable est dans `docs/` — les
leçons de méthode dans [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md).

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
      | `src/resources/js/socializer/callbacks/` (8 fichiers) | aucun importeur depuis la suppression de la v1. Le seul import à gabarit restant (`socializer_custom_elements/routes/application.js`) vise `rooms/components/`. Preuve à rejouer avant de supprimer : le build n'émet aucun chunk `callbacks/` — [conventions.md](../docs/architecture/conventions.md#avant-de-déclarer-un-fichier-orphelin) |
      - [ ] Code — supprimer ou implémenter, poche par poche
      - [ ] Doc — la section « Zones mortes connues » disparaît à mesure ; la supprimer quand elle
            est vide
      - [ ] Tests — `artisan route:list` et `artisan list` inchangés ; suite JS verte

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
      ⚠️ **Cette entrée a gagné un consommateur le 01/09, et c'est ce qui la rend délicate à traiter
      maintenant** : D1 se sert de ce défaut **comme d'un contrat** — `conn.metadata.from === mon
      slug` est le seul discriminant disponible pour savoir si une connexion est sortante, et
      `WhiteboardComponent#handleConnectionOpen` en dépend pour ne pas renvoyer sa scène deux fois
      (D2 en dépendra aussi, cf. lot 1 · D). Un renommage en `localFrom` **casserait ce garde en
      silence** : le champ absent rend `undefined`, jamais égal à mon slug, donc la comparaison
      redevient vraie partout et le double envoi revient sans une erreur. Préalable à cette entrée :
      exposer le sens de la connexion **explicitement** (un champ, ou un argument de callback) et y
      brancher les consommateurs, AVANT de toucher au nom.
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
      Faute de frappe figée dans les squelettes de modèles (`grep -rln ACCESORS src/`), que `docs/architecture/conventions.md` entérine avec un « *(sic)* »
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
      Le test existe : `useSignalingQueue.test.js`, describe « absence de précondition
      asynchrone ». Reste à réduire la doc à une ligne qui le nomme.
      Annotation : `docs/INDEX.md` · `docs/modules/webrtc2/architecture.md`
      - [ ] Code — sans objet · - [ ] Doc — trois paragraphes → une ligne · - [x] Tests

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
      ⚠️ C'est un renommage sur un chemin de sécurité : ce sont les deux prédicats que lit le moteur
      de retry, et les confondre est la panne du 13/08.
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
      Épinglé : `mockFidelity.test.js`, « getConnections est lu sans `.value` — donc jamais
      enveloppé dans un computed ». Reste le volet doc : ne garder qu'une ligne qui nomme ce cas.
      Annotation : `docs/architecture/conventions.md` · `docs/modules/webrtc2/tests.md`
      - [x] Code · - [ ] Doc · - [x] Tests

- [ ] **Les « pièges de mock »** · effort [M]
      `docs/modules/webrtc2/tests.md` énumère les façons dont le harnais peut verdir pour
      la mauvaise raison (`_pushSignal` écrivant dans une structure que `getQueueForRoom` ne lit
      pas ; `handleRemoteDeparture` qui avale ses exceptions ; `setLocalPeer` mocké en
      `vi.fn(() => true)` fabriquant un booléen que la production ne produit jamais — « deux tests
      validaient ainsi une branche inexistante »).
      **Chacun de ces pièges devrait être un test de conformité du mock, pas une puce de doc.**
      C'est la plus grosse conversion C du paquet.
      - [ ] Code — étendre le test de conformité · - [ ] Doc · - [ ] Tests

- [ ] **`json_encode` échappe les `/`** · effort [S]
      Le sérialiseur transforme l'aiguille : l'assertion de non-fuite de chemin « a cessé de garder
      quoi que ce soit **sans virer au rouge** ». Un test mort et indétectable, trouvé seulement en
      contre-épreuve. À épingler par une contre-épreuve permanente, pas par un paragraphe.
      Annotation : `docs/architecture/tests.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

## Lot 5 — À arbitrer, et assumés · sortie D

- [ ] **`updateScene` applique une charge vide sans le dire** · effort [S] — **relevé le 01/09/2026**
      en corrigeant le renvoi de scène du Whiteboard. `loadWhiteBoard` rend `$page->content ?? null`
      quand aucun document n'existe ; côté client, `updateScene` finit par appeler
      `excalidrawAPI.updateScene({ elements: undefined })` — **no-op muet**. « Tableau vide » et
      « chargement raté » sont donc indistinguables à l'écran.
      ℹ️ **Reproduit, pas supposé** : en écrivant
      `Whiteboard/__tests__/WhiteboardComponent.connectionOpen.test.js`, un mock résolvant `null` a
      fait lever `data.hasOwnProperty` — le mock a donc dû résoudre une scène valide, et le fichier
      le dit.

- [ ] **`loadScene()` n'a aucun `.catch`, et il est appelé avant l'existence de son `$refs`** ·
      effort [S] — **relevé le 01/09/2026.** Tout échec HTTP y est un **rejet non traité**, sans
      trace. Et l'appel est dans `created()`, donc avant que `$refs.excalidrawElement` existe : il ne
      tient que par la latence réseau.

- [ ] **La fenêtre où `excalidrawAPI` n'est pas prêt à l'arrivée d'une scène** · effort [M] —
      **relevé le 01/09/2026.** `updateScene` abandonne sur un `console.error`, sans réessai — même
      classe de défaut que celui qui vient d'être corrigé. Mesuré **peu probable** (le renvoi arrive
      ~1 s après une connexion elle-même établie 1-3 s après le montage), et **c'est pour ça que le
      délai d'une seconde du renvoi doit rester** : il protège le **récepteur**, pas l'émetteur — ne
      pas l'« optimiser ». Sortie possible : signal `excalidraw-ready` + application différée de la
      dernière scène.

- [ ] **`getPayloadSizeBytes` accepte ce que BinaryPack refuse** · effort [M] — **ouvert le
      01/09/2026 par la vérification de D1**, qui l'a payé : voir le 🔴 du lot D1.
      Le garde anti-DoS mesure via `JSON.stringify`, qui accepte une `Map` (elle rend `{}`). Elle
      atteint donc `conn.send`, où **BinaryPack LÈVE** — de façon synchrone, dans le `forEach` de
      diffusion : les pairs suivants ne reçoivent rien et l'exception remonte à l'appelant. Le garde
      rejette bien une **fonction nue**, ce qui donne l'illusion d'être couvert.
      **Détectable à coût nul** : le `JSON.stringify` du garde est déjà fait, un `replacer` qui
      refuse `Map`/`Set`/instance de classe suffirait à transformer un throw en refus journalisé —
      exactement le traitement déjà réservé au dépassement de taille. Et **testable**, contrairement
      au bug lui-même : `usePeerTransport.mesh.test.js` porte déjà le cas « laisse passer une `Map` »,
      qui rougira le jour où le garde sera posé.
      ⚠️ **Alternative écartée, à ne pas re-proposer sans lire ceci** : `serialization: 'json'` sur la
      connexion data reproduirait la v1 pour tous les consommateurs — et **aucun n'envoie de binaire
      en production**, vérifié. Mais c'est une propriété de **transport**, avec une falaise de
      compatibilité entre deux onglets sur des bundles différents (le paquet a déjà ce risque
      documenté), et elle périmerait le cas `ArrayBuffer` épinglé.
      Annotation : `docs/modules/webrtc2/api.md` (la section « `sendData` peut LEVER ») ·
      `docs/modules/webrtc2/tests.md` (le piège de mock) · `docs/modules/webrtc2/securite.md` (même
      mécanique que le garde de taille)
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **Le Whiteboard ne se synchronise que sur un relâchement de pointeur** · effort [M] —
      **relevé le 01/09/2026 en instruisant le cas de l'image collée.**
      `ExcalidrawElement` n'émet que **deux** événements : `excalidraw-mouseup` (sur `pointerup`) et
      `excalidraw-pointer` (sur `pointermove`). Le `onChange` qui émettrait `excalidraw-change` est
      **commenté dans le JSX** (l.36-38), et son écoute est commentée dans le composant Vue
      (`mounted` / `beforeUnmount` / la méthode `handleExcalidrawChange`).
      **Conséquence : tout ce qui ne finit pas par un relâchement de pointeur sur le canvas ne
      propage rien** — un collage (`Ctrl+V`), un `Ctrl+Z`, la touche Suppr, une insertion depuis la
      bibliothèque. L'auteur voit sa modification, les autres non, **jusqu'au prochain clic** — et
      sans un mot en console des deux côtés, puisque rien n'est même tenté. C'est ce qui a fait
      croire, un moment, que l'image butait sur les 64 Ko.
      ⚠️ **Antérieur à la migration** : la v1 avait les deux mêmes événements et le même `onChange`
      commenté. Ce n'est pas une régression de D1.
      ⚠️ **Et ce n'est pas une ligne à décommenter** : `onChange` tire à **chaque** modification, y
      compris pendant un tracé — brancher tel quel inonderait le canal de scènes complètes, chacune
      pouvant approcher le plafond. Un débounce ne suffit pas à le rendre raisonnable : c'est la même
      tâche que la synchronisation par **delta**, ci-dessus. Les traiter ensemble ou pas du tout.
      Annotation : aucune — le fait n'est écrit nulle part, et c'est le défaut
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`ExcalidrawElement.updateScene` lit `data.state`, que personne n'émet** · effort [S] —
      **relevé le 01/09/2026 en corrigeant D1.**
      `this.excalidrawAPI.updateScene({ elements: data.elements, appState: data.state, files: data.files })`
      — or l'émetteur envoie `{ elements, appState, files }`, et le serveur stocke la même forme.
      `data.state` vaut donc **toujours `undefined`** : l'`appState` transmis et **stocké** est mort
      depuis toujours, en v1 comme en v2. C'est ce fait qui a rendu le correctif de D1 gratuit.
      ⚠️ **Ce n'est PAS une faute de frappe à réparer.** Lire `data.appState` allumerait la
      réplication de l'appState : le scroll, le zoom et la sélection de l'émetteur seraient copiés
      chez le récepteur à chaque `mouseup` — et la `Map` `collaborators` reviendrait sur le fil.
      **Décision produit d'abord** : veut-on répliquer une vue, ou seulement un dessin ? Si non, le
      correctif est l'inverse — retirer `appState` de ce qui est **stocké** aussi, et la ligne
      devient `appState: undefined` explicite ou disparaît.
      Annotation : aucune aujourd'hui — le fait n'est écrit que dans `work/`, et c'est correct tant
      que la décision n'est pas prise
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **La scène du Whiteboard n'a aucune découpe et le plafond de 64 Ko l'abandonne en silence** ·
      effort [M] — **ouvert le 01/09/2026 par D1**, et **assumé en l'état à cette date**.
      `update_scene` transporte `getSceneElements()` + `getFiles()` : le plus gros payload du paquet,
      et **le seul dont la taille est pilotée par l'utilisateur**. *(L'`appState` en faisait partie
      jusqu'au correctif de D1, qui l'a retiré — le terme dominant est désormais `files`.)* Une image
      collée dans le tableau, encodée en base64 dans `files`, franchit `MAX_PAYLOAD_BYTES` (64 Ko) — et
      l'émission est alors **entièrement annulée**, avec pour seule trace un `console.warn` chez
      l'émetteur. Symptôme produit : « le tableau ne se synchronise plus », sans erreur.
      ⚠️ **C'est une régression de la migration v1 → v2, pas une limite historique** : le `sendData`
      du store v1 n'avait aucun plafond (`safeStringify` puis `conn.send`, PeerJS chunkant lui-même).
      ✅ **MESURÉ le 01/09/2026, à deux navigateurs** — le chiffre que cette tâche réclamait :
      **`[Mesh] Payload ignoré: trop volumineux (294409 octets > 65536)`** pour une scène portant
      **une seule image collée**. Soit **4,5× le plafond**. Quelques tracés seuls passent sans
      problème ; c'est bien `files` (le dataURL base64) qui domine, et lui seul.
      **Ce que la mesure élimine :** passer le base64 en binaire ne gagnerait que ~27 % (≈ 215 Ko,
      toujours 3× trop), et un plafond relevé « un peu » ne résout rien — il faudrait des **Mo**.
      **Les sorties qui restent, et aucune n'est petite :**
      · **relever `MAX_PAYLOAD_BYTES` à l'échelle des images** — ⚠️ c'est la surface anti-DoS de
      [`securite.md`](../docs/modules/webrtc2/securite.md), appliquée aux **deux** bouts : accepter
      5 Mo en émission, c'est accepter que n'importe quel pair m'en pousse 5 Mo par trame ;
      · **sortir les images du canal data** — elles sont déjà persistées côté serveur sur un tableau
      `isSavable` (`saveWhiteBoard`) : n'émettre que les `elements` et laisser le récepteur chercher
      le fichier. ⚠️ Ne couvre **pas** les tableaux non savables, qui n'ont aucune copie serveur ;
      · **découper en frames applicatives**, ou **synchroniser par delta** — la seule qui fasse aussi
      baisser le débit de `update_scene` en régime nominal, et la seule qui traite le fond.
      Annotation : `docs/modules/webrtc2/api.md` (sous `api.sendData`, le ⚠️ qui nomme la scène
      Excalidraw) · `WhiteboardComponent.vue` (docblock de `handleExcalidrawMouseUp`)
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`destroy()` de PeerJS émet `disconnected` avant de poser `_destroyed`** — bug de dépendance
      tierce, vérifié dans `peerjs@1.5.4` (l.1810 avant l.1781). Trois gardes empilées le
      compensent. Sortie D : décision datée, plus un test de conformité du mock (déjà partiellement
      là). Un rapport amont serait la seule sortie A.
      Annotation : `docs/modules/webrtc2/architecture.md`

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
      un chantier. Le harnais le dit déjà (docblock de `FakeNebulaGraph`, « correspondance de
      sous-chaîne, pas une analyse du nGQL ») ; reste la décision datée, et retirer les deux
      fichiers de doc qui le répètent.
      Annotation : `docs/architecture/tests.md` · `docs/modules/webrtc2/securite.md`

- [x] **Trous de couverture** — **fermé en clôturant le plan de tests WebRTC2.** La citation
      (« **Rien** pour Feed, Comment, Server, User, System… ») était devenue **fausse sur quatre
      modules** : Feed, Server, User et System ont un filet. C'était exactement le mode de panne
      annoncé — une liste d'absences se périme sans virer au rouge.
      `docs/architecture/tests.md` dit désormais **où il y a un filet, pas combien**, avec la
      commande qui recense les fichiers ; ce qui reste réellement à découvert y tient en une ligne.
