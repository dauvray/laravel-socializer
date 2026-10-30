# Application — Todo

> Les défauts du module **Application tel qu'il tourne aujourd'hui** : une app monofichier par
> salon, rendue dans une iframe. Ce fichier ne porte **aucune direction** pour la suite du module :
> le chantier « Application v2 » ouvert le 28/10/2026 a été retiré le 30/10/2026, décision de
> David, pour repartir de zéro — il ne sert pas de point de départ. Les défauts ci-dessous lui
> survivent parce qu'ils sont dus quelle que soit la direction prise.
>
> Relu par mesure le 30/10/2026 par une session paire (graphe en doublure, Mongo de substitution,
> lectures seules sur la base de dev). Sa première version déclarait sain le chemin de création —
> c'est la deuxième section ci-dessous.
>
> Effort : `[S]` `[M]` `[L]`

---

## 🔴 Les quatre routes du module n'ont AUCUNE garde d'autorisation `[M]`

### Ce qui est exact, vérifié le 30/10/2026

- **Le périmètre est « tout utilisateur connecté ET vérifié ».** Les quatre routes vivent dans
  `routes/socializer/routes.private.php`, chargé sous
  `config('estarter.routes_middlewares.classic.private')`. Dans le bac à sable, cette clé vaut
  `['web', 'auth', 'routeProtect', 'verified', 'restrictedMode']` ; le défaut du socle est le même
  sans `restrictedMode`. `routeProtect` ne compense pas : aucun `MenuItem` ne correspond à ces URI
  (mesuré sur la base de dev), et sans `MenuItem` il laisse passer.
- **Aucune garde, ni dans les services ni dans les contrôleurs**, qui ne font que déléguer. Les
  identifiants viennent tous du client :

  | Route | Méthode | Ce que tout connecté peut faire |
  |---|---|---|
  | `iaApp.save` | `ApplicationIA::saveApplicationIA` | réécrire `code` et `infos` de n'importe quelle app, désignée par son `vertexid` ; `infos.published` pose ou retire l'arête `published_in` vers `marketplace`, donc publier ou dépublier l'app d'un autre |
  | `iaApp.load` | `ApplicationIA::loadApplicationIA` | lire le code **et les données** de l'app de n'importe quel salon, privé compris, désigné par `room_id` |
  | `iaApp.database` | `ApplicationIA::databaseAction` | créer, modifier, supprimer les enregistrements de n'importe quelle app |
  | `store.load.applications` | `Store::getApplications` | rien d'utile aujourd'hui — voir la section `dd()` |

- **Pourquoi 🔴 : le code d'une app s'exécute avec l'origine de l'hôte chez chaque membre.**
  `ApplicationComponent.vue` écrit l'app dans le `contentDocument` d'une iframe
  `sandbox="allow-scripts allow-same-origin allow-modals allow-forms"`. Une iframe écrite par son
  parent a l'origine du parent, et `allow-scripts` + `allow-same-origin` sur un contenu de même
  origine annule le bac à sable : le script atteint `window.parent` et peut retirer l'attribut
  (fait de spécification, non rejoué en navigateur). Réécrire le code d'une app, c'est donc faire
  exécuter son JS dans la session de chaque membre qui ouvre le salon.

### ⚠️ Le correctif naïf est faux — ne pas le poser

- **`canJoinRoom` n'est pas un prédicat d'appartenance** : même piège que le tableau blanc, pour
  les mêmes deux raisons — lire la section « Le correctif naïf est faux DEUX fois » de
  [`whiteboard-todo.md`](whiteboard-todo.md), non recopiée ici.
- **`iaApp.database` ne se réserve pas à qui écrit le code.** Cette route est appelée **par l'app
  elle-même**, chez chaque membre qui s'en sert (`ApplicationComponent.vue`, action `database` du
  pont `postMessage`). La fermer aux seuls auteurs casse toute app qui enregistre une donnée.
- **La garde se pose dans le service, pas dans le contrôleur** :
  `config('socializer.controllers_front.application_ia')` et `config('socializer.controllers_front.store')`
  sont substituables par l'hôte, et une garde posée dans le contrôleur disparaît chez qui le
  remplace.

### La décision à prendre avant d'écrire une ligne

Ce n'est pas un oubli de garde, c'est une politique absente. Elle appartient à David :

- [ ] **Qui ÉCRIT le code d'une app ?** Le propriétaire du serveur seul, comme à la création, ou
      d'autres que lui ?
- [ ] **Qui LIT une app, code et données ?** Les membres du salon, ou ce que permet la visibilité
      du salon ?
- [ ] **Qui ÉCRIT dans la base d'une app ?** Au minimum ceux qui peuvent l'utiliser — voir le piège
      `iaApp.database` ci-dessus.

### Une fois tranché

- [ ] Poser les gardes dans `ApplicationIA` et `Store`. Chaque `// todo a protéger` ne part
      qu'avec la garde qu'il réclame : celui de `createApplicationVertice` attend la section
      suivante.
- [ ] Un test PHP par route (Orchestra Testbench, depuis le paquet — `docs/architecture/tests.md`) :
      connecté non membre, membre, propriétaire. **Rouges d'abord** : aujourd'hui tout passe, et un
      test d'autorisation écrit après le correctif est vert dès qu'il ne mesure rien. Mongo se
      contourne par un stub de modèle via `config('socializer.models.*')` — précédent :
      `GroupServerProjectionTest` avec `tests/Stubs/Page.php` ; il n'existe pas encore de stub
      `Application`.
- [ ] Écrire la règle retenue **une seule fois** dans la doc du module — aujourd'hui une ligne de
      `docs/modules/autres-modules.md`, une page à elle si la règle déborde — et y renvoyer d'ici.

---

## 🔴 Un propriétaire de serveur crée une app dans le salon de N'IMPORTE QUEL serveur `[M]`

`Server::createSubContent` lit `roomId` et `serverId` dans la requête et ne vérifie que
`isServerOwner($server_id)`. Rien ne relie `roomId` à `serverId` avant `_createContent`, qui
atteint `createApplicationVertice($room_id, …)`.

**Mesuré le 30/10/2026** (graphe en doublure) : propriétaire d'un serveur A, `roomId` d'un salon
d'un serveur B → 200 « Salon crée » ; l'app et sa page sont créées, `published_in` relie l'app au
salon de B, et le demandeur en devient le créateur. Contre-épreuve, un seul paramètre changé
(`serverId` d'un serveur non possédé) → 401, rien de créé.

- **Ce n'est pas propre à Application.** Le même entonnoir `_createContentVertex` crée chat, page
  et tableau blanc — lu, pas rejoué.
- `createApplicationVertice` n'a qu'un site d'appel, dans `_createContentVertex`, atteint par deux
  chemins : `createRoomServer`, sain (le salon vient d'y être créé sous le serveur vérifié), et
  `createSubContent`, qui ne l'est pas. **Son `// todo a protéger` dit vrai** : ne pas le retirer
  avant le correctif.
- Deux apps peuvent désormais être publiées dans un même salon, et `loadApplicationIA` prend
  `$app_vertex[0]` sans ordre : laquelle est servie n'est pas mesuré.
- La garde elle-même interpole `serverId` dans le nGQL — section suivante.

- [ ] **Décision de David** : créer un contenu dans un salon exige-t-il que ce salon appartienne au
      serveur possédé ? Et, puisque chat, page et tableau blanc passent par le même entonnoir,
      l'item vit-il ici ou dans un todo transverse ?
- [ ] Vérifier dans le graphe que le salon appartient au serveur, dans le service, avant toute
      création.
- [ ] Test PHP, **rouge d'abord** : le cas mesuré ci-dessus (propriétaire de A, salon de B) est
      refusé et ne crée rien.

---

## 🔴 Des valeurs du client sont interpolées dans le nGQL `[M]`

`NebulaGraphConnection::stringFormat` encadre une chaîne d'apostrophes **sans l'échapper**, et
plusieurs requêtes écrites à la main interpolent directement. Sur les chemins du module, mesuré le
30/10/2026 (graphe en doublure, requête générée relue) :

| Où | Valeur du client | Mesure |
|---|---|---|
| `ApplicationIA::loadApplicationIA` | `room_id` | `where id(r) == 'r1' OR 1==1 //' …` |
| `Socializable::isServerOwner` — la garde de création | `serverId` | `WHERE id(s) == 's1' OR 1==1 //' …` ; contourner la garde ainsi : non mesuré |
| `getNextPublishedPosition` (`Helpers/Socializer.php`) | `roomId` de `/create-sub-content` | injectable |
| `insertVertex` via `stringFormat`, dans `createApplicationVertice` (l'app, puis sa page) | `content.name`, `content.image` de `/create-sub-content` | `Mon app', 'X` sort du littéral ; contre-épreuve `Mon app` intacte |

- **Les arêtes y échappent, mais en silence** : `getEdgeDirection` ne garde d'un id que
  `[a-zA-Z0-9]+` — mesuré, `def456' OR 1==1 //` devient `def456`, tronqué **sans erreur**. Un id
  forgé y devient donc un autre id valide, pas un refus.
- **Mongo** : `saveApplicationIA` (`vertexid`) et `databaseAction` (`vertexid` → `application_id`)
  acceptent un objet JSON. `{"vertexid":{"$ne":null}}` compile en `{"vertexid":{"$ne":null}}`
  (`mongodb/laravel-mongodb` 5.7.1 ; compilé, pas exécuté contre la base).
- ⚠️ **`stringFormat` et `isServerOwner` servent tout le paquet** : ce tableau ne relève que les
  chemins d'Application. L'inventaire des autres modules n'est pas fait, et le correctif de
  `stringFormat` est transverse.

**Ne dépend d'aucune décision** : se corrige sans attendre les gardes.

- [ ] Valider les identifiants avant toute requête : des chaînes, sur une liste blanche de
      caractères. ⚠️ Pas sur le seul format de `uniqidReal()` : la projection pose aussi des ids
      **dérivés** (`Server::createServer`, paramètre `$vertex_id`). La borne existe déjà :
      `getEdgeDirection` impose `[a-zA-Z0-9]+` à tout id qui passe par une arête, donc un id hors
      de cet alphabet est cassé dès aujourd'hui.
- [ ] Échapper les valeurs dans `stringFormat` — transverse, voir ci-dessus.
- [ ] Test PHP : une valeur forgée est refusée **sans qu'aucune requête n'atteigne le graphe**.
      ⚠️ `FakeNebulaGraph` fait du `str_contains` et ne parse pas le nGQL
      ([`doc-rustines.md`](doc-rustines.md)) : un test qui laisse la requête partir vers la doublure
      puis juge sa réponse est vert sur du code vulnérable. Asserter zéro requête, pas une réponse.

---

## 🟠 `Store::getApplications` : un `dd()`, et une arête `has_creator` écrite à l'envers `[S]`

- **Le `dd($results)` répond un 500 permanent, quel que soit `APP_DEBUG`.** C'est celui de
  `symfony/var-dumper`, qui pose le 500 hors CLI ; le dumper se choisit sur `VAR_DUMPER_FORMAT` et
  le SAPI, jamais sur `app.debug` (lu, pas rejoué en HTTP). Il est là depuis le commit initial : la
  route n'a jamais rendu de JSON. Appelant front : `loadApplications()` dans
  `stores/store/actions.js`.
- **Aujourd'hui le dump est vide, parce que l'arête est à l'envers.** Le `MATCH` lit
  `(a:application)-[:has_creator]->(u:user)`, mais `createApplicationVertice` appelle
  `setHasCreatorRelation($this->user->vertexid, $new_vid)` alors que la signature est
  `($vid, $creator_vid)` : l'arête va de l'utilisateur vers l'app. Graphe de dev, en lecture
  seule : app → user 0, user → app 1, pour une app au total. C'est le seul écrivain de cette arête
  pour une app, et le Store son seul lecteur.

⚠️ **L'ordre des correctifs compte.** Remettre l'arête dans le bon sens AVANT de retirer le `dd()`
ouvre une fuite : le dump livrerait alors à tout connecté les sommets `user` complets des créateurs
(`name`, `identifier`, `slug`, `connected`…). **Le `dd()` part en premier.**

⚠️ **Retirer le `dd()` ne rend pas la route utile**, pour deux raisons : l'arête, puis
`Arr::pluck($results, 'id')`, qui rend un `null` par ligne (l'id est sous `a`). `whereIn` compile
alors en `$in: [null]`, qui matche aussi les documents **sans** `vertexid`.

- [ ] Retirer le `dd()` et ne rendre que `infos` et `vertexid`, jamais un sommet utilisateur.
- [ ] Ensuite seulement, écrire l'arête dans le bon sens, et redresser celles déjà en base
      (migration ou projection) : sans quoi elles restent à l'envers.
- [ ] Lire l'id sous `a`, pas au premier niveau de la ligne.
- [ ] Test PHP : la réponse ne contient aucun sommet `user`.

---

## 🟢 Les dépendances déclarables : une clé inconnue empêche l'app de démarrer `[S]`

`ApplicationComponent.vue` traduit `code.dependencies` en balises à travers la table de
`Application/settings.js`. Rejoué sous Node 22 le 30/10/2026, avec la vraie `settings.js` et le
code de résolution recopié :

- **Une clé inconnue lève, et l'app entière ne démarre pas** : `getDependencyLink(undefined)` →
  `TypeError` sur `url.search`, dans le `try` de `loadComponent` ; l'erreur s'affiche et l'iframe
  n'est jamais écrite. Deux clés sont inconnues par construction :
  - `replace(" ", ".")` transforme `ag grid` en `ag.grid` : la clé `ag grid` est inatteignable ;
  - la table orthographie `ddompurify` : une app qui déclare `dompurify` ne démarre pas.
- **En silence, l'app part sans sa bibliothèque** : une valeur **tableau** (`vueuse`,
  `papaparse`, `tinymce`, `dropzone`) ne produit aucune balise — le `return` est dans le
  `forEach`, le `map` reçoit `undefined`, que `join('')` efface ; `pdf.js` produit un `<script>`
  vers `cdnjs.com/libraries/pdf.js`, une page HTML (200 `text/html`).

- [ ] Corriger les quatre.
- [ ] Tests Vitest (depuis la racine de l'hôte) : chaque clé de `settings.js` produit au moins une
      balise, et **une clé inconnue ne lève pas**.

---

## 🟢 Le pont `postMessage` : deux pièges, un seul mesuré

- **Envoi vers l'iframe** : `sendMessageToIframe` passe `window.location.origin` à
  `JSON.stringify` comme *replacer* (ignoré), et `postMessage` part sans `targetOrigin` explicite.
  Ça marche grâce au défaut `"/"`, même origine. Le jour où l'iframe change d'origine, plus rien
  n'est livré, sans erreur (fait de spécification). Pas un défaut aujourd'hui : un nom qui ment.
- **Réception depuis l'iframe** : `handleMessageFromIframe` rejette tout message dont
  `event.origin` diffère de `import.meta.env.VITE_APP_URL`, une valeur **figée au build** de
  l'image. Sur un déploiement dont l'URL diffère de celle du build, toute action de l'iframe serait
  refusée, `database` compris — non mesuré. Une valeur qu'un déployeur ajuste n'a pas sa place
  dans une clé `VITE_*`.

- [ ] Mesurer le second sur un déploiement réel, et le sortir de `VITE_*` s'il se confirme.

---

## Ce qui reste non mesuré

- L'évasion du bac à sable en navigateur (fait de spécification).
- Le contournement de `isServerOwner` par injection, et la portée réelle de l'injection dans
  `loadApplicationIA`.
- Qui peut devenir propriétaire d'un serveur, donc combien de comptes la création croisée concerne.
- Quelle app `loadApplicationIA` sert quand deux apps sont publiées dans un même salon.
- Le 500 du `dd()` en HTTP réel.
- Le filtre `VITE_APP_URL` sur un déploiement dont l'URL diffère de celle du build.

---

## Ailleurs, et volontairement pas ici

- **La prop `room` d'Application**, dont le défaut rend `undefined` et dont le correctif évident
  casse le provider, est dans [`front-todo.md`](front-todo.md) — non recopiée.
