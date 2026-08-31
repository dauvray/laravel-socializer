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

### Cette suite ne calcule aucune mise en page

`happy-dom` (comme jsdom) n'implémente pas de moteur de rendu : `getBoundingClientRect()` y rend
des zéros, et `getComputedStyle` ne résout pas la cascade d'une feuille externe.

**N'y écrivez donc jamais d'assertion de géométrie.** Elle est soit rouge sur du code correct, soit
verte sur les deux états — jamais discriminante. Ce n'est pas une difficulté à contourner, c'est
une impossibilité, et changer de DOM virtuel n'y changerait rien.

Ce qui la remplace vit dans **`tests/visual/`** : un harnais Playwright lancé **à la main**,
invisible aux deux runners (`phpunit.xml` ne déclare que `tests/Feature` ; l'`include` de
`vitest.config.js` ne prend que `src/resources/js/**/__tests__/**/*.test.js`). Playwright y est
résolu depuis un runtime **hors dépôt**, ce qui laisse le `package.json` de l'hôte intact — et rend
ces vérifications non portables, ce qui est assumé.

> **Principe de partage** : la suite n'asserte que sur des **fichiers versionnés** ; `tests/visual/`
> asserte sur les artefacts de **build**, où une absence ou une péremption doit être un échec dur,
> jamais un silence.

Ce qu'il reste possible d'épingler dans la suite, et qu'il ne faut pas abandonner sous prétexte que
la mise en page échappe : le **contrat DOM** dont dépend une règle CSS — qu'une classe d'intention
soit bien rendue, qu'un nœud contienne ou ne contienne pas tel enfant.

**Découper avant de conclure « pas testable ».** Un 🔴 de WebRTC2 — une vignette effondrée à
0 px — était une chaîne de **sept** maillons, dont **six étaient des faits sur des fichiers
versionnés** : un jeu de classes rendu, l'absence d'un enfant, une règle SCSS présente. Un seul
relevait du moteur de rendu. Le défaut n'était donc pas « invérifiable », il était **non vérifié sur
six maillons vérifiables** — et ces six sont dans la suite aujourd'hui. Une sortie « on assume » ne
vaut que pour ce qui reste après ce découpage, et il reste presque toujours moins que le craint
(règle 6).

⚠️ **Pourquoi pas `@playwright/test` dans les dépendances de l'hôte.** La question se repose à
chaque ajout ici ; la réponse tient à un fait unique : **il n'y a aucune CI.** Sans CI, la
couverture réelle d'une suite Playwright et d'un script `node` est identique — ce qui tourne est ce
qu'on lance —, pour le prix d'une dépendance à faire approuver et d'un test qui appartient au
**paquet**, lequel n'a ni `package.json` ni `node_modules`. Le fixture et les assertions se
transposent sans changement le jour où une CI existe : c'est ce qui rend l'arbitrage réversible,
donc tenable. Il se rouvre avec la CI, pas avant.

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

### Les décisions du harnais

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
     ⚠️ **Le corollaire coûte plus cher que la limite : la doublure rend la FORME qu'on lui
     script.** Elle ne compte rien et ne décode rien. Deux conséquences vécues :
     - **Aucun chiffre rendu par le graphe n'est prouvé par la suite** — un compteur reste vert avec
       la mauvaise requête. Seule une contre-épreuve nGQL sur un vrai cluster prouve un nombre.
     - **Une forme de résultat scriptée à tort masque un défaut de décodage** : une requête à **une
       seule** colonne rend une liste **plate**, pas des lignes associatives. Un test scriptant des
       lignes associatives est vert pendant que la production lit `null` par un accès à clé sur une
       chaîne, silencieux sous `??`.
   - **`fakeNebulaGraphConnection()`** fait l'inverse : elle instancie la **vraie**
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
   (`tests/Stubs/Estarter/app/Events/`, pour les listeners de réplica) ne lèvent
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

⚠️ **Et il reste un quatrième étage que rien ne remplace : ouvrir la page.** Les deux derniers
défauts bloquants du paquet ont été trouvés ainsi, **les deux suites au vert** — une vignette
effondrée à 0 px, et une boucle de rechargement qui empêchait *toute* connexion (un invité recevait
401 sur la page de login, `AjaxService` rechargeait ; 168 navigations en 20 s, mesuré). Le second ne
se voyait même pas sur la machine de développement, dont le cache `route:cache` était antérieur aux
routes concernées — **un `route:cache` construit au déploiement l'aurait rendu en production.** Une
suite verte dit que les faits épinglés tiennent ; elle ne dit pas que l'application fonctionne.

### Le 0 croisé décide du découpage en fichiers

**Combien de fichiers de test pour une fonctionnalité n'est pas une question de rangement : c'est
une mesure.** La méthode : muter une ligne, compter les cas rouges **par fichier**. Quand une
mutation rougit un fichier et **zéro** cas des autres, elle vient de nommer une frontière réelle.

Quatre mesures concordantes l'ont établi, chacune sur une fonctionnalité différente :

| Mutation | rougit | reste vert |
|---|---|---|
| l'un des deux bouts d'un joint entre deux couches | 3 et 2 cas du fichier du joint | **0** dans les deux fichiers d'étage |
| le nom d'une prop exposée par un composant d'un autre paquet | 8 cas du fichier qui monte le vrai composant | **0** du fichier qui le double |
| la clé d'un `provide` dont le dépôt n'a qu'un `provide` et qu'un `inject` | 1 cas du fournisseur | **0** dans les deux autres |
| un attribut de couture, une prop coupée, deux écouteurs croisés | le fichier de la couture | **0** de celui du composant |

La règle qui en sort : **quand une propriété tient à un joint entre deux étages, aucun test d'étage
ne peut la voir mourir.** Les deux couches restent vertes pendant que plus rien n'arrive à l'écran.
Il faut le fichier du joint, et c'est la mesure qui l'impose — pas le goût.

Trois corollaires, tous payés :

- **Deux fichiers que la mesure sépare ne sont pas des doublons.** Les fusionner « pour
  simplifier » perd la détection, sans qu'un seul cas ne rougisse au moment de la fusion.
- **Un double définit la surface, donc il est structurellement aveugle à un renommage en amont.**
  Un fichier qui double sa dépendance ne peut pas voir une clé disparaître de ce qu'elle expose : le
  double, lui, l'expose toujours. D'où le fichier jumeau qui monte la dépendance **réelle** et ne
  fait que ça.
- **Ne pas stuber ce dont le nom EST le contrat.** Un stub qui expose `nomAttendu` valide sa propre
  orthographe. C'est la mesure qui l'interdit, et le dépôt en avait le cadavre : deux composants
  voisins exposant deux clés différentes.

### Les règles

1. **Un bug vécu s'écrit d'abord en repro, rouge avant le fix.** C'est le seul protocole qui n'a
   jamais produit de régression derrière lui.
2. **Asserter le fait métier, jamais l'implémentation.** Un test vert **d'emblée** est un mauvais
   signe : il ne teste pas ce qu'on croit.
3. **Un mock qui ment est pire qu'un test manquant** — il rend vert pour la mauvaise raison.
4. **Contrôle de harnais** : neutraliser la ligne de production censée porter le correctif et
   vérifier que les tests rougissent. Le résultat s'écrit dans le docblock du test — sans quoi le
   prochain lecteur le re-mesure.
5. **Une assertion négative ne vaut que si on l'a vue rouge une fois.** Elle ne signale rien quand
   elle cesse de garder quoi que ce soit — voir juste en dessous.
6. **Un énoncé est une affirmation, pas un constat — le relire contre le code est la première
   étape de la tâche, pas une précaution.** Vaut pour les trois formes rencontrées :
   - un **« pas testable »** annoté dans une doc ou un docblock : ceux trouvés ici étaient faux, et
     le vrai blocage était ailleurs et plus petit. Exhiber la dépendance qui bloque, nommément —
     l'ensemble transitif réel est presque toujours plus court que le craint ;
   - un **énoncé de tâche**, même écrit par soi-même : périmé, il ne fait pas que perdre du temps,
     il fait écrire un test qui **demande au code de régresser**. C'est arrivé — un énoncé décrivait
     un comportement que la suite épinglait déjà à l'envers, et le suivre aurait fait « corriger »
     le code pour verdir le test ;
   - un **périmètre annoncé** : plusieurs fois faux, et dans les deux sens — un fichier déjà couvert
     sous un autre nom, un défaut dont le site vivait hors du dossier nommé.

   Le coût de la relecture est toujours inférieur à celui d'un lot écrit sur un énoncé faux.
7. **Un contrôle à 0 se lit dans cet ordre, et « la ligne est inutile » vient en dernier.** Quatre
   lots consécutifs ont produit des contre-épreuves à zéro, et la faute était **dans le test** à
   chaque fois avant d'être ailleurs :
   1. **faute du test** — le périmètre ne discrimine pas ce qu'il croit (voir la règle du périmètre
      à un seul élément dans [modules/webrtc2/tests.md](../modules/webrtc2/tests.md#ce-quil-faut-savoir-avant-décrire)) ;
   2. **une autre ligne absorbe la mutation** — quand deux mécanismes indépendants tiennent la même
      propriété, il faut les neutraliser **tous les deux**. Une ligne redondante peut *désarmer* le
      contrôle du voisin : tant qu'un `v-bind="$attrs"` superflu était là, le contrôle
      `inheritAttrs: false` rougissait 0 cas d'un côté contre 1 chez son jumeau ;
   3. **la référence n'a pas été relue à 0** — alors le contrôle ne mesure rien. Un « 1 cas rougi »
      a déjà été celui d'une régression **déjà présente**, pas celui de la mutation ;
   4. **et le contrôle lui-même se prépare** : pour mesurer un `catch`, retirer le `try` avec lui —
      vider le corps laisse la suite compiler sans rien mesurer, le retirer seul l'empêche de
      compiler, et le 0 se lit alors « ce `catch` ne sert à rien ».

   Un **0 conservé s'écrit avec sa raison** : contrat d'une sentinelle, message d'erreur porté à la
   place d'une trace opaque, garde décoratif assumé. Sans cette ligne, il sera re-mesuré ou supprimé.

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

Le meilleur exemple du dépôt tient dans un seul dossier —
`WebRTC2/Widgets/Mediaplayer/Composables/`, deux fichiers voisins de part et d'autre de la règle :
`useRemotePeerState` enregistre `onUnmounted` (**obligatoire**), `useMediaControls` n'enregistre
rien et n'injecte rien (**interdit** : il ne touche qu'un élément DOM qu'on lui passe). Depuis le
retrait de ses deux drapeaux d'état, le second n'importe même plus rien de Vue — le critère se lit
donc sur son en-tête d'import, sans avoir à parcourir le fichier.

---

## Ce qui est couvert aujourd'hui

La liste des fichiers se relit par `find src/resources/js -path '*__tests__*' -name '*.test.js'`,
et les cas dans la sortie du runner. **Ce qui suit dit où il y a un filet, pas combien.**

- **WebRTC2** — les trois étages, de loin le module le mieux couvert. Harnais, invariants et
  pièges de mock : [modules/webrtc2/tests.md](../modules/webrtc2/tests.md), qui nomme aussi ce qui
  reste délibérément hors filet.
- **System** — `useReverbChannel` (dont le désabonnement d'un whisper par callback), et
  `Notifications.vue` en deux fichiers : son propre câblage, et la **couture** avec les boutons
  d'appel de WebRTC2 — celle-ci parce que la mesure l'a imposée, cf.
  [le 0 croisé](#le-0-croisé-décide-du-découpage-en-fichiers).
- **Server** — la navigation entre rooms, et le libellé d'état de connexion.
- **Feed** — le câblage de cycle de vie de `Feed.vue` : ordre de démontage, join du canal avant le
  chargement des posts, routage des listeners Reverb vers les actions du store.
- **User** — une amorce, `coverCallButton`.
- **Chat** — `dateSeparatorRender` seulement. Plan en 5 couches, non démarré :
  [`work/chat-tests-plan.md`](../../work/chat-tests-plan.md), avec une décision en attente sur les
  helpers (dédiés à Chat, ou promotion des helpers WebRTC2 vers un dossier partagé).
- **PHP** — le socle Testbench, les routes de signalisation vues du serveur, et les gardes
  d'autorisation de `Socializable` : gardes de canal de broadcast et garde de relation. Ce que ces
  gardes décident, et ce que le harnais ne prouve pas d'eux :
  [modules/webrtc2/securite.md](../modules/webrtc2/securite.md).
- **La projection MySQL → NebulaGraph** — le contrat de `GraphProjection` (elle compte et rapporte,
  elle ne décide pas), l'idempotence du réseau d'un utilisateur, du sommet d'un article, et du
  serveur d'un groupe avec son propriétaire résolu sans acteur authentifié :
  `tests/Feature/Graph/`. Ce que ces fichiers ne prouvent pas est écrit en tête de chacun.
- **Rien** pour Comment, Application, Whiteboard, Page, les stores Pinia hors `peers2`, ni les
  services PHP au-delà de l'inscription au chat et de la projection.

Les invariants d'une doc de module (`docs/modules/*`) sont des **points de test**, pas des choses à
contourner : quand une doc dit « ne pas optimiser ceci », le test correspondant est ce qui l'épingle.
