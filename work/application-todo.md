# Application — Todo

> Les défauts du module **Application tel qu'il tourne aujourd'hui** : une app monofichier par
> salon, rendue dans une iframe. C'est la **partie 1** : elle corrige ces défauts et **prépare** la
> partie 2, [`application-todo-v2.md`](application-todo-v2.md) — ce qui la prépare se fait ici,
> chaque section concernée dit pourquoi. Le chantier « Application v2 » ouvert le 28/10/2026, lui,
> a été retiré le 30/10/2026, décision de David, pour repartir de zéro : il ne sert pas de point de
> départ.
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

- [x] **Qui ÉCRIT le code d'une app ?** **Décision de David du 30/10/2026 : tout utilisateur
      autorisé, et pas seulement le créateur de l'app.** « Autorisé » = titulaire d'une permission
      accordée par un admin **et** inscrit au salon de l'app. Elle vient de la partie 2
      ([`application-todo-v2.md`](application-todo-v2.md)) ; la garde se pose ici selon cette règle
      pour ne pas être réécrite là-bas. Ce qu'elle implique :
      - **la permission n'existe pas.** Aucune ligne de `permissions` ne concerne les apps (base de
        dev, 30/10), et le paquet ne déclare aucune permission (`src/`, `src/database/` compris :
        grep vide). Son nom, et l'endroit où le paquet la déclare, sont à choisir au lot. Deux
        précédents à regarder : le paquet **utilise** `can('list_users')` sans la déclarer
        (`UserController`, `Services/Users.php`), et `MenuTableSeeder` porte un champ
        `"permission" => null` par entrée de menu ;
      - **« inscrit au salon » n'a pas de prédicat.** `canJoinRoom` n'en est pas un (section
        ci-dessus) ; la donnée est l'arête `registered_in` user → room, le prédicat strict reste à
        écrire ;
      - **la garde d'écriture ne lit pas `has_creator`** : elle ne dépend ni du redressement de
        l'arête ni de l'ordre imposé par le `dd()` ;
      - **le propriétaire du serveur est autorisé d'office** (décision de David du 30/10/2026) :
        il modifie les apps de son serveur sans la permission. La règle complète est donc
        « propriétaire du serveur de l'app, OU permission ET inscrit au salon ». ⚠️ Le serveur de
        l'app se lit dans le graphe, jamais dans la requête — c'est exactement la faille de la
        section « Un propriétaire de serveur crée une app… ». Le chemin salon → serveur à
        emprunter n'est pas vérifié ici ;
      - **l'interface doit suivre la même règle** : `Room.vue` passe `:editable="isOwner"`, le
        propriétaire du **serveur** seul. Un titulaire de la permission inscrit au salon n'y verrait
        pas l'éditeur ;
      - **créer le contenu « application » dans un salon** (`createSubContent`, réservé au
        propriétaire du serveur) n'est **pas** couvert par cette décision ;
      - ⚠️ **la permission ne s'accorde qu'une fois l'iframe isolée et l'historique en place** —
        les deux sections suivantes.
- [ ] **Qui LIT une app, code et données ?** Les membres du salon, ou ce que permet la visibilité
      du salon ?
- [ ] **Qui ÉCRIT dans la base d'une app ?** Au minimum ceux qui peuvent l'utiliser — voir le piège
      `iaApp.database` ci-dessus.

### Une fois tranché

- [ ] Poser les gardes dans `ApplicationIA` et `Store`. Chaque `// todo a protéger` ne part
      qu'avec la garde qu'il réclame : celui de `createApplicationVertice` attend la section « Un
      propriétaire de serveur crée une app… ».
- [ ] Un test PHP par route (Orchestra Testbench, depuis le paquet — `docs/architecture/tests.md`) :
      connecté non membre, membre, propriétaire. **Rouges d'abord** : aujourd'hui tout passe, et un
      test d'autorisation écrit après le correctif est vert dès qu'il ne mesure rien. Mongo se
      contourne par un stub de modèle via `config('socializer.models.*')` — précédent :
      `GroupServerProjectionTest` avec `tests/Stubs/Page.php` ; il n'existe pas encore de stub
      `Application`.
- [ ] Écrire la règle retenue **une seule fois** dans la doc du module — aujourd'hui une ligne de
      `docs/modules/autres-modules.md`, une page à elle si la règle déborde — et y renvoyer d'ici.

---

## 🔴 Le code d'une app s'exécute avec l'origine de l'hôte — les gardes de route n'y changent rien `[M]`

C'est le « pourquoi 🔴 » de la section précédente, qui n'avait pas de tâche. Les gardes décident
**qui écrit le code** ; elles ne protègent pas **les membres contre ce code**.

**Mesuré le 30/10/2026** par une session paire, sur une page synthétique qui reproduit le mécanisme
(drapeaux `sandbox` exacts, `contentDocument.write`, cookie `SameSite=Lax` host-only) — **pas** sur
le vrai composant —, sous Chromium 149 et Firefox 151, mêmes résultats. L'app a l'origine de
l'hôte : elle lit `localStorage`, voit le cookie `XSRF-TOKEN` (non `httponly`) et `parent.document`,
et ses `fetch` — `credentials` par défaut ou `include`, `GET` comme `POST` — partent **avec** la
session, réponse **lisible**. Elle ne fait donc pas qu'appeler une route au nom de qui l'ouvre, un
admin compris : elle lit les réponses et le DOM du parent. Lu dans la source, non observé :
`PreventRequestForgery` accepte `Sec-Fetch-Site: same-origin` sans jeton. Depuis la décision du
30/10 (tout utilisateur autorisé écrit), accorder la permission sans isoler donnerait à chaque
titulaire la session de chaque membre des salons où il écrit.

**Pourquoi ici et pas dans la partie 2** : c'est ce qui rend la décision « qui écrit » tenable, et
le pont que la partie 2 formalise s'appuiera sur la validation par `event.source`. Le remède ne
demande **aucune infrastructure, ni sous-domaine** : une origine opaque suffit à isoler. L'origine
dédiée reste dans la partie 2, seulement sur besoin.

### Le remède : `srcdoc`, sans `allow-same-origin`

Le document de l'iframe prend une origine opaque. Mesuré le 30/10 dans les mêmes conditions, chaque
point dans les deux navigateurs :

- `contentDocument` vaut `null` : le HTML assemblé part par `srcdoc`.
- Les messages de l'iframe arrivent avec `event.origin === "null"`, et
  `event.source === iframe.contentWindow` est vrai : c'est sur lui que se valide l'entrant. Le
  filtre `VITE_APP_URL` (section 🟢 « Le pont `postMessage` ») disparaît avec.
- `localStorage`, `document.cookie`, `parent.document` et `top.location` lèvent `SecurityError`. Les
  `fetch` (par défaut, `include`, `POST`), une image, une navigation de l'iframe sur elle-même en
  `GET` et un formulaire `POST` partent **sans** cookie, réponse illisible : les trois routes `GET`
  de `routes.private.php` qui suppriment (`delete-conversation`, `delete-user-server`,
  `delete-server-room`) ne sont pas atteignables avec la session depuis l'iframe.
- `/vendor/estarter/embed-iframe.js`, en chemin relatif, se résout bien sur l'hôte.
- Le `srcdoc` hérite de la CSP du parent, comme l'`about:blank` actuel — la plateforme n'en pose
  aucune (grep vide dans l'hôte, son `docker/` et le socle ; un reverse proxy de production n'est
  pas vérifié). Une `<meta http-equiv="Content-Security-Policy">` posée par le parent en tête du
  `srcdoc` s'y cumule : retirée par le script, ou doublée d'une `<meta>` laxiste, elle bloque
  toujours, et elle couvre les iframes imbriquées `srcdoc`, `data:` et `blob:`. Une CSP propre aux
  apps ne demande donc pas d'autre origine.

⚠️ **Prémisse** : la session est en `SameSite=Lax`, sans `Domain` (vu en service :
`secure; httponly; samesite=lax`). Si elle passait un jour en `SameSite=None`, cette protection
tomberait probablement — non mesuré, la sonde tournait en http.

### ⚠️ Tel quel, le remède casse le pont dans les deux sens — EN SILENCE

Mesuré le 30/10, mêmes conditions :

- **Parent → iframe** : `sendMessageToIframe` appelle `postMessage` sans `targetOrigin`, donc avec
  le défaut `"/"`, la même origine. Vers une origine opaque, le message est jeté **sans exception**.
  Une origine opaque ne se nomme pas : l'envoi doit passer en `"*"`. Il livre alors à tout document
  chargé dans l'iframe, y compris celui vers lequel l'app aurait navigué — rien de neuf, vu la
  section « la navigation » ci-dessous (raisonnement, non mesuré).
- **Iframe → parent** : les quatre `Exemples/` envoient par
  `parent.postMessage(msg, window.location.origin)`. Sous `srcdoc`, `location.origin === "null"`, et
  l'appel **lève** (Chromium « Invalid target origin 'null' », Firefox `SyntaxError`). `SimpleCrud`
  et `SongManager` filtrent en plus l'entrant sur `event.origin !== window.location.origin` : ils
  rejettent tout message du parent.
- **Et rien ne le montre** : `embed-iframe.js` envoie en `"*"`, donc `resize_iframe` arrive,
  `componentLoaded` passe à vrai, et l'app s'affiche chargée alors que `database` et `broadcast`
  sont morts.

Les `Exemples/` servent de modèles : les apps en base les ont probablement recopiés (non mesuré).

### ⚠️ Ce qu'aucune CSP ne couvre : la navigation

Mesuré le 30/10 : sous `default-src 'none'; script-src 'unsafe-inline'`, un
`location.href = '<serveur>/…?k=…'` atteint ce serveur, dans les deux navigateurs. Une app peut
donc sortir dans une URL **tout ce qu'on lui livre** — les données de `DATABASE_PLACEHOLDER`, la
liste des membres. Une CSP par en-tête, sur une origine dédiée, a la même limite. **Tout ce qui
entre dans l'iframe appartient à l'auteur de l'app** : c'est une donnée de la question « qui LIT ».

### Au passage : le gabarit corrompt le code d'une app

L'assemblage du HTML, que ce lot réécrit pour `srcdoc`, passe par `String.replace` avec une chaîne
de remplacement, qui interprète `$'`, `` $` `` et `$&` : `'a<!-- X -->b'.replace('<!-- X -->', "x$'y")`
rend `axbyb` (mesuré, Node). Une chaîne `'$'` dans le script d'une app suffit à y recopier la fin du
gabarit. Remplacer par une fonction : `.replace(placeholder, () => valeur)`.

- [ ] **Décision de David** : faire passer l'envoi en `"*"` côté app en réécrivant les `Exemples/`
      (et les apps en base), ou injecter dans le gabarit un petit module d'envoi que les apps
      appellent — l'amorce du SDK de la partie 2.
- [ ] **Décision de David** : assumer que tout ce qui est livré à l'iframe appartient à l'auteur de
      l'app — ou ne plus lui livrer ce que l'auteur ne doit pas lire.
- [ ] Isoler — `srcdoc`, envoi en `"*"`, entrant validé sur `event.source`, `replace` par
      fonction —, avec un test Vitest : un message dont `event.source` n'est pas l'iframe est
      ignoré.
- [ ] Le rejouer sur le **vrai** composant, en navigateur : une app d'exemple démarre, `database` et
      `broadcast` passent **dans les deux sens**, et un `fetch('/…')` lancé depuis l'app part sans
      cookie de session. Un `resize_iframe` reçu ne prouve rien.
- [ ] Avant de livrer, inventorier les apps en base : chercher `location.origin` dans
      `applications.code.script`.

---

## 🟠 Un écrasement n'a pas de retour arrière `[S]`

`saveApplicationIA` remplace `code` sans rien garder. Tenable tant qu'un seul auteur écrivait ;
depuis la décision du 30/10, tout utilisateur autorisé peut écraser l'app d'un autre.

**Décision de David du 30/10/2026, non figée** : un historique **léger** — seules quelques versions
précédentes sont gardées. Leur nombre et la forme de la restauration ne sont pas fixés.

**Pourquoi ici et pas dans la partie 2** : il doit exister avant que la permission soit accordée,
et le versionnement est une brique que la partie 2 reprendra.

Proposition, non mesurée : à chaque enregistrement, pousser la version **enregistrée** (pas la
précédente) dans un tableau borné, par un seul `updateOne` qui pose `code` et fait
`$push` + `$each` + `$slice` sur l'historique. Aucune lecture préalable, donc pas de course entre
deux enregistrements — le défaut même de `databaseAction` (section 🟠 plus bas). À une réserve
près, relevée en relecture : une mise à jour **par opérateurs**, jamais le `save()` d'Eloquent, qui
réécrit le document.

- [ ] Garder les N dernières versions de `code` à chaque enregistrement (N non figé).
- [ ] Restaurer une version — sous la même garde que l'écriture.
- [ ] Test PHP : au-delà de N, la plus ancienne disparaît ; un non-autorisé ne restaure rien.

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

## 🟠 `databaseAction` perd des écritures concurrentes `[S]`

Lu le 30/10/2026, pas rejoué. `ApplicationIA::databaseAction` relit tout le tableau `data` du
document `page`, le modifie en PHP et réécrit le document : deux membres qui écrivent dans la même
fenêtre, le second efface le premier. Et `DATABASE_PLACEHOLDER` livre toutes les données de l'app
à chaque membre au chargement — à relire avec la question « qui LIT » de la première section.

**Pourquoi ici et pas dans la partie 2** : cette action est le germe de la capacité `data` de
[`application-todo-v2.md`](application-todo-v2.md), qui se bâtira dessus. Et la garde de
`iaApp.database` (première section) se pose dans la même méthode : un seul lot.

- [ ] Opérations atomiques Mongo (`$push`, `$pull`, mise à jour positionnelle) au lieu de réécrire
      le tableau.

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
  n'est livré, sans erreur — mesuré le 30/10 vers une origine opaque (section 🔴 « Le code d'une
  app s'exécute… »). Pas un défaut aujourd'hui, un nom qui ment ; il le devient avec l'isolation.
- **Réception depuis l'iframe** : `handleMessageFromIframe` rejette tout message dont
  `event.origin` diffère de `import.meta.env.VITE_APP_URL`, une valeur **figée au build** de
  l'image. Sur un déploiement dont l'URL diffère de celle du build, toute action de l'iframe serait
  refusée, `database` compris — non mesuré. Une valeur qu'un déployeur ajuste n'a pas sa place
  dans une clé `VITE_*`.

- [ ] Mesurer le second sur un déploiement réel, et le sortir de `VITE_*` s'il se confirme — ou
      le laisser partir avec l'isolation (section 🔴 « Le code d'une app s'exécute… »), qui valide
      sur `event.source`.

---

## Ce qui reste non mesuré

- Le retrait de l'attribut `sandbox` par l'app (fait de spécification). Le reste de l'évasion est
  mesuré : section 🔴 « Le code d'une app s'exécute… ».
- Le palier `srcdoc` sur le vrai composant, sous Firefox 133 (une partie du parc GHU), et
  `Sec-Fetch-Site` effectif en https.
- La course de `databaseAction`.
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
