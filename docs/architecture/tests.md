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
cd /var/www/estarter-test      # ← la racine du projet HÔTE, pas le package
npm run test:run               # une passe
npm run test                   # mode watch
npm run test:ui                # interface Vitest
npm run test:coverage
```

Configuration : `/var/www/estarter-test/vitest.config.js`. Points à connaître :

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
cd /var/www/estarter-test/vendor/dauvray/laravel-socializer
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
2. **Aucune migration du package.** Celles qu'il enregistre contiennent du MongoDB et du
   NebulaGraph : injouables sur sqlite. Le harnais crée à la main les tables dont il a besoin —
   `users`, et `group_user` pour le garde de relation, dont la migration vit qui plus est dans un
   **autre** package (estarter). Il n'utilise **pas** `RefreshDatabase`.
3. **NebulaGraph remplacé au conteneur.** Le package n'atteint le graphe que par
   `app('nebulaGraph')` — couture unique, d'où `fakeNebulaGraph()`. C'est ce qui rend les gardes de
   relation testables. ⚠️ **Sa limite** : `FakeNebulaGraph` fait du `str_contains` sur le nGQL, il ne
   le **parse** pas. Un test vert sur une jambe qui interroge le graphe prouve le câblage, jamais la
   requête — une requête syntaxiquement invalide passe au vert. Ces requêtes se contre-vérifient
   contre un vrai NebulaGraph.
4. **Les broadcasts s'observent par `Event::fake()`.** Il n'existe **pas** de `Broadcast::fake()`
   dans Laravel 13. `Broadcast::private(…)->sendNow()` construit un `AnonymousEvent` que
   `PendingBroadcast::__destruct` remet au dispatcher : c'est là qu'on l'intercepte. Helpers :
   `fakeBroadcasts()`, `assertBroadcastSent()`, `assertNoBroadcastSent()`.
5. **Les dépendances de la famille sont doublées, pas installées.** Le package a des dépendances
   implicites vers `Dauvray\Estarter\*` et `Innovation\formdesigner\*`
   ([package.md](package.md#dépendances-implicites)), qui vivent dans un GitLab **privé** ; les
   déclarer mettrait une URL interne dans le manifeste d'un package publié sur GitHub public.
   `tests/Stubs/` en porte donc des doublures, mappées par `autoload-dev`. ⚠️ **Elles lèvent toutes**
   plutôt que de renvoyer `null` : une doublure silencieuse ferait passer au vert un test qui
   croirait exercer le vrai comportement. Elles ne s'étoffent que quand un test l'exige.

Deux doublures sont là uniquement parce que `ServiceProvider::boot` fait un `require_once` de **tous**
les `src/app/Helpers/*.php` : sans elles, l'application de test ne démarre pas.

> **Défaut de fixture.** `makeUser()` inscrit l'utilisateur dans `DEFAULT_GROUP_ID`, donc deux
> utilisateurs du harnais sont joignables au sens de `mayReach` sans rien déclarer. Sans ce défaut,
> les suites qui testent **autre chose** (throttle, fuite d'exception, validation) échoueraient toutes
> en 403 sans rapport avec ce qu'elles vérifient. Passer `groupId: null` pour un inconnu — c'est ce
> dont `RelationGuardTest` a besoin, et écrire ce fichier avec le défaut le rendrait entièrement vert
> pour la mauvaise raison.

> **Piège Eloquent.** Le trait `Socializable` fait
> `$this->fillable = array_merge($this->fillable, ['is_bot'])`. Définir `fillable`, même
> indirectement, **annule** `guarded` : un modèle de test en `guarded = []` se retrouve avec le seul
> `is_bot` assignable, et `create()` insère une ligne vide. Le stub déclare donc `$fillable`.

---

## Le filet automatique

`hooks/pre-push` refuse de pousser une suite rouge. Activation, une fois, dans le dépôt du package :

```bash
cd /var/www/estarter-test/vendor/dauvray/laravel-socializer
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

### Quatre règles

1. **Un bug vécu s'écrit d'abord en repro, rouge avant le fix.** C'est le seul protocole qui n'a
   jamais produit de régression derrière lui.
2. **Asserter le fait métier, jamais l'implémentation.** Un test vert **d'emblée** est un mauvais
   signe : il ne teste pas ce qu'on croit.
3. **Un mock qui ment est pire qu'un test manquant** — il rend vert pour la mauvaise raison.
4. **Contrôle de harnais** : neutraliser la ligne de production censée porter le correctif et
   vérifier que les tests rougissent. Quand deux mécanismes indépendants tiennent la même propriété,
   il faut les neutraliser tous les deux — et c'est à écrire dans le docblock du test.

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
- **Signalisation WebRTC (PHP)** — le socle Testbench et les routes de signalisation vues du
  serveur. C'est le premier test PHP du package ; le lot backend qui s'appuie dessus est suivi dans
  [`work/webrtc2-securite-2026-08-14.md`](../../work/webrtc2-securite-2026-08-14.md).
- **Rien** pour Feed, Comment, Server, User, System, Application, Page, Whiteboard, les stores Pinia
  hors `peers2`, ni le reste des services PHP.

Les invariants d'une doc de module (`docs/modules/*`) sont des **points de test**, pas des choses à
contourner : quand une doc dit « ne pas optimiser ceci », le test correspondant est ce qui l'épingle.
