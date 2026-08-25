# Tests

> **À quoi ça sert :** où vivent les tests, comment les lancer, et la stratégie commune.
> **Quand le lire :** avant d'écrire le premier test d'un module.

---

## Deux suites, et elles ne tournent pas au même endroit

| Suite | Lancée depuis | Outillage |
|---|---|---|
| **JS** (Vitest) | la racine du projet **hôte** | `vitest.config.js`, `node_modules` de l'hôte |
| **PHP** (PHPUnit) | **ce dépôt** | `phpunit.xml` + `vendor/` propres au package |

---

## Suite JS — côté hôte

Le package **n'a ni `package.json` ni `node_modules`** : il est développé directement dans
`vendor/` du projet hôte, qui porte tout l'outillage front.

```bash
cd ../../..                    # ← la racine du projet HÔTE, pas le package
npm run test:run               # une passe
npm run test                   # mode watch
npm run test:ui                # interface Vitest
npm run test:coverage
```

Configuration : le `vitest.config.js` **de l'hôte**, à sa racine. Points à connaître :

- `include` cible **uniquement** le package :
  `vendor/dauvray/laravel-socializer/src/resources/js/**/__tests__/**/*.test.{js,ts}`
- environnement **happy-dom**, `globals: true`, `testTimeout: 10_000`
- alias `~` · `~socializer` · `~estarter` · `~formdesigner` · `~eblogger` — les mêmes que
  `vite.config.js`, et **`peerjs` est redirigé vers le mock** du module WebRTC2
- `setupFiles` pointe sur `components/WebRTC2/__tests__/setup.js` — donc les mocks globaux
  (`mediaDevices`, `RTCPeerConnection`, `crypto`, Pinia fraîche) s'appliquent à **tous** les tests du
  package, pas seulement à WebRTC2
- ⚠️ **pas de `clearMocks`** : les `vi.fn()` globaux de `setup.js` ne sont pas réinitialisés entre les
  tests. Faire ses `mockReset()` en `beforeEach`.

---

## Suite PHP — dans le package, via Orchestra Testbench

```bash
cd vendor/dauvray/laravel-socializer   # depuis la racine du projet hôte
composer install        # une fois — crée un vendor/ propre au package (gitignoré)
vendor/bin/phpunit
```

Testbench fabrique une application Laravel de test : **aucun serveur n'est requis** — ni MySQL, ni
MongoDB, ni NebulaGraph, ni Reverb. Le `vendor/` du package vit à l'intérieur de celui de l'hôte ;
c'est sans effet (l'autoloader de l'hôte ne le voit pas) et c'est gitignoré.

### Les cinq décisions du harnais

Elles sont toutes contraintes par l'état réel du package. Les défaire sans lire ce qui suit fait
perdre une demi-journée — le détail et le pourquoi vivent dans le docblock de `tests/TestCase.php`.

1. **Pile de middlewares sans `web`.** `ServiceProvider::boot` pousse
   `Dauvray\Estarter\...\UserActivity` dans le groupe `web`. `defineEnvironment` réduit donc
   `estarter.routes_middlewares.classic.private` à `['auth']`. ⚠️ **Delta assumé** : la pile de test
   n'est pas celle de production (`['web','auth','routeProtect','verified','restrictedMode']`).
   Le groupe **public** est réduit à `[]` (production : `['web','routeProtect','restrictedMode']`).
   **Ne jamais l'étoffer** : `routeProtect` et `restrictedMode` sont des alias posés par les
   providers d'estarter et de formdesigner, absents du harnais — le conteneur lèverait
   `Target class [routeProtect] does not exist` sur *toute* la suite. Corollaire : une route
   publique se teste ici pour sa **logique** (le garde `Auth::check()` du contrôleur), jamais pour
   sa traversée de la pile ; celle-là se vérifie en curl sur le dev.
2. **Aucune migration du package.** Celles qu'il enregistre contiennent du MongoDB et du
   NebulaGraph : injouables sur sqlite. Le harnais crée à la main les tables dont il a besoin —
   `users`, et `group_user` pour le garde de relation, dont la migration vit qui plus est dans un
   **autre** package (estarter). Il n'utilise **pas** `RefreshDatabase`.
3. **NebulaGraph se double à DEUX niveaux, et le choix n'est pas indifférent.**
   - **`fakeNebulaGraph()`** remplace la connexion entière au conteneur — le package n'atteint le
     graphe que par `app('nebulaGraph')`. C'est le bon outil pour le **câblage** d'un garde : quelle
     requête part, dans quel ordre, quel verdict en sort. ⚠️ **Sa limite** : elle fait du
     `str_contains` sur le nGQL, elle ne le **parse** pas. Un test vert sur une jambe qui interroge
     le graphe prouve le câblage, jamais la requête — une requête syntaxiquement invalide passe au
     vert. Ces requêtes se contre-vérifient contre un vrai NebulaGraph.
   - **`fakeNebulaGraphConnection()`** (E7) fait l'inverse : elle instancie la **vraie**
     `NebulaGraphConnection` et ne double que le client Thrift (`FakeThriftClient`, injecté par le
     2ᵉ argument du constructeur — sans lui la classe ouvre un socket et reste intestable). C'est le
     seul outil pour la **couture** : que le décodage distingue une erreur nGQL d'un résultat vide,
     que les écritures DML lèvent, que les lectures **ne** lèvent pas (tout le refus par défaut des
     gardes en dépend), et quel nGQL est réellement construit. ⚠️ Ses charges JSON sont **écrites à
     la main**, pas capturées : la limite se déplace d'un cran, elle ne disparaît pas. Les remplacer
     par des captures datées dès qu'un accès au cluster est disponible.
4. **Les broadcasts s'observent par `Event::fake()`.** Il n'existe **pas** de `Broadcast::fake()`
   dans Laravel 13. `Broadcast::private(…)->sendNow()` construit un `AnonymousEvent` que
   `PendingBroadcast::__destruct` remet au dispatcher : c'est là qu'on l'intercepte. Helpers :
   `fakeBroadcasts()`, `assertBroadcastSent()`, `assertNoBroadcastSent()`.
5. **Les dépendances de la famille sont doublées, pas installées.** Le package a des dépendances
   implicites vers `Dauvray\Estarter\*` et `Innovation\formdesigner\*`
   ([package.md](package.md#dépendances-implicites)), qui vivent dans un GitLab **privé** ; les
   déclarer mettrait une URL interne dans le manifeste d'un package publié sur GitHub public.
   `tests/Stubs/` en porte donc des doublures, mappées par `autoload-dev`. ⚠️ **Elles lèvent par
   défaut** plutôt que de renvoyer `null` : une doublure silencieuse ferait passer au vert un test
   qui croirait exercer le vrai comportement. Elles ne s'étoffent que quand un test l'exige — et
   alors **explicitement**, sur un état déclaré et asserté dans les deux sens. Le seul cas à ce
   jour : `FakeOnlineUsers::isOnlineUser`, que `PresenceUser` lit pour le champ `connected`, scripté
   par `pretendOnline()` et couvert par `PresencePayloadTest`. Toute autre forme d'appel de cette
   même méthode continue de lever.
   ⚠️ La règle vise les doublures de **comportement**. Les doublures d'**événements**
   (`tests/Stubs/Estarter/app/Events/`, ajoutées par E7 pour les listeners de réplica) ne lèvent
   pas : un événement ne porte aucun comportement, c'est un porteur de données, et le reproduire à
   l'identique ne peut mentir sur rien.
   ⚠️ **Un modèle d'une AUTRE base est un troisième cas** : `tests/Stubs/Page.php` double par un
   Eloquent sqlite un modèle Mongo, parce que `mongodb/laravel-mongodb` n'est pas installé ici — sans
   lui, toucher `app\Models\Page` lève `Class "MongoDB\Laravel\Eloquent\Model" not found`, avant
   toute question de connexion. C'est jouable **parce que** le paquet n'atteint jamais ces modèles
   autrement que par `config('socializer.models.*')`, et la fidélité s'arrête aux trois opérations
   que le code demande (`create()`, `->id`, `->vertexid = …; save()`). Tout ce qui dépend vraiment de
   Mongo reste hors de portée du harnais et se vérifie sur le dev.

Deux doublures sont là uniquement parce que `ServiceProvider::boot` fait un `require_once` de **tous**
les `src/app/Helpers/*.php` : sans elles, l'application de test ne démarre pas.

> **Défaut de fixture.** `makeUser()` inscrit l'utilisateur dans `DEFAULT_GROUP_ID`, donc deux
> utilisateurs du harnais sont joignables au sens de `mayReach` sans rien déclarer. Sans ce défaut,
> les suites qui testent **autre chose** (throttle, fuite d'exception, validation) échoueraient toutes
> en 403 sans rapport avec ce qu'elles vérifient. Passer `groupId: null` pour un inconnu — c'est ce
> dont `RelationGuardTest` a besoin, et écrire ce fichier avec le défaut le rendrait entièrement vert
> pour la mauvaise raison. Même précaution pour les gardes de canal : un test de non-appartenance à
> un serveur écrit avec le défaut serait vert pour la mauvaise raison.

> **Piège Eloquent.** Le trait `Socializable` fait
> `$this->fillable = array_merge($this->fillable, ['is_bot'])`. Définir `fillable`, même
> indirectement, **annule** `guarded` : un modèle de test en `guarded = []` se retrouve avec le seul
> `is_bot` assignable, et `create()` insère une ligne vide. Le stub déclare donc `$fillable`.

---

## Le filet automatique

`hooks/pre-push` refuse de pousser une suite rouge. Activation, une fois, dans le dépôt du package :

```bash
cd vendor/dauvray/laravel-socializer   # depuis la racine du projet hôte
git config core.hooksPath hooks
```

Il lance **les deux suites** : PHP d'abord (la plus rapide, donc elle échoue en premier), puis JS. Il
remonte l'arborescence pour trouver `phpunit.xml` d'un côté et le `vitest.config.js` de l'hôte de
l'autre, et **dégrade proprement** — dépendances absentes ⇒ suite non lancée, push autorisé, message
explicite. Un hook qui bloque un push parce qu'on n'a pas installé de quoi le vérifier se fait
désactiver en une semaine. Contournement délibéré : `git push --no-verify`.

⚠️ **Il n'y a pas de CI.** Pas de `.github/` dans ce dépôt : `hooks/pre-push` est le seul filet
automatique, et son activation est une config **locale**, jamais versionnée.

**Rien ne se pousse en rouge.** La raison est historique : plusieurs régressions ont été introduites
*le jour même* par le correctif précédent, faute de filet automatique entre les deux.

---

## Stratégie : trois étages

C'est le découpage validé sur WebRTC2, et le modèle à reprendre.

| Étage | Rôle |
|---|---|
| **Unitaire** | une couche, dépendances injectées mockées. C'est tout l'intérêt de l'injection descendante : les couches extraites se testent avec des `vi.fn()`. |
| **Conformité** | le mock ne ment ni par omission ni par invention — comparaison **mécanique** de sa surface à celle du vrai store. |
| **Bout en bout** | deux acteurs **réels** qui se parlent, assertés sur le fait métier. |

L'étage bout en bout est celui qui manque toujours et sans lequel les vrais symptômes ne sont pas
observables : ils ne sont vrais ou faux que **vus de l'autre côté**.

### Cinq règles

1. **Un bug vécu s'écrit d'abord en repro, rouge avant le fix.** C'est le seul protocole qui n'a
   jamais produit de régression derrière lui.
2. **Asserter le fait métier, jamais l'implémentation.** Un test vert **d'emblée** est un mauvais
   signe : il ne teste pas ce qu'on croit.
3. **Un mock qui ment est pire qu'un test manquant** — il rend vert pour la mauvaise raison.
4. **Contrôle de harnais** : neutraliser la ligne de production censée porter le correctif et
   vérifier que les tests rougissent. Quand deux mécanismes indépendants tiennent la même propriété,
   il faut les neutraliser tous les deux — et c'est à écrire dans le docblock du test.
5. **Une assertion négative ne vaut que si on l'a vue rouge une fois.** Elle ne signale rien quand
   elle cesse de garder quoi que ce soit — voir juste en dessous.

### Le sérialiseur transforme l'aiguille

`ExceptionLeakTest` asserte que la réponse 500 des routes de signalisation ne contient ni chemin de
fichier, ni trace, ni classe d'exception. L'assertion sur le **chemin** ne pouvait plus jamais
matcher : `json_encode` échappe les `/` en `\/`, donc chercher `/var/www/…` dans le corps JSON brut
de `$response->getContent()` est vert quoi qu'il contienne.

Le test ne fonctionnait que contre la forme initiale du bug — un `return $ex;` rendu en texte brut
par `Response::setContent`. Dès que la réponse est devenue du JSON, l'assertion a cessé de garder
quoi que ce soit **sans virer au rouge**. Les assertions voisines sur `'#0 '` et `'RuntimeException'`
tenaient toujours : aucune ne contient de `/`.

**Règle.** Pour tout test de non-fuite sur un corps sérialisé, déséchapper avant de chercher
(`str_replace('\\/', '/', $response->getContent())`) ou asserter sur le corps **décodé**. Se méfier
de toute aiguille contenant `/`, `"` ou un caractère que le sérialiseur transforme : chemin, URL,
regex. Trouvé uniquement en contre-épreuve (faire fuiter `$ex->getMessage()` volontairement et
constater que les cas restaient verts) — jamais en relisant le test.

⚠️ **Aucun décompte de tests dans `docs/`.** Ce chiffre a divergé du réel dans trois documents à la
fois, tous datés du même jour. Il se relit dans la sortie du runner.

---

## `withSetup` : obligatoire ou interdit

Un composable qui enregistre un hook de lifecycle (`onMounted`, `onUnmounted`, `onBeforeMount`) ou
qui `inject` **doit** être monté par `withSetup`. Un composable qui n'en enregistre aucun s'appelle
**directement** — le passer dans `withSetup` masque le fait qu'il est pur.

C'est un critère de conception autant qu'un détail de test : une couche qui perd ses hooks devient
testable directement, et ça se voit.

---

## Ce qui est couvert aujourd'hui

- **WebRTC2** — les trois étages, de loin le module le mieux couvert. Harnais, invariants et
  pièges de mock : [modules/webrtc2/tests.md](../modules/webrtc2/tests.md). Avancement chiffré et
  ce qui reste : [`work/webrtc2-tests-plan.md`](../../work/webrtc2-tests-plan.md).
- **Chat** — un seul fichier (`dateSeparatorRender.test.js`). Plan en 5 couches, non démarré :
  [`work/chat-tests-plan.md`](../../work/chat-tests-plan.md), avec une décision en attente (helpers
  dédiés vs partagés — `mockEcho`, `mockRoute`, `seedChatStore`).
- **PHP** — le socle Testbench, les routes de signalisation vues du serveur, et les gardes
  d'autorisation de `Socializable` : gardes de canal de broadcast et garde de relation. Ce que ces
  gardes décident, et ce que le harnais ne prouve pas d'eux :
  [modules/webrtc2/securite.md](../modules/webrtc2/securite.md).
- **La projection MySQL → NebulaGraph** — le contrat de `GraphProjection` (elle compte et rapporte,
  elle ne décide pas), l'idempotence du réseau d'un utilisateur, du sommet d'un article, et du
  serveur d'un groupe avec son propriétaire résolu sans acteur authentifié :
  `tests/Feature/Graph/`. Ce que ces fichiers ne prouvent pas est écrit en tête de chacun.
- **Rien** pour Feed, Comment, User, System, Application, Whiteboard, les stores Pinia hors
  `peers2`, ni les services PHP au-delà de l'inscription au chat et de la projection.

Les invariants d'une doc de module (`docs/modules/*`) sont des **points de test**, pas des choses à
contourner : quand une doc dit « ne pas optimiser ceci », le test correspondant est ce qui l'épingle.
