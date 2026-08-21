# Vue d'ensemble du package

> **À quoi ça sert :** ce qu'est `laravel-socializer`, comment il s'insère dans le projet hôte,
> et où vit quoi.
> **Quand le lire :** en arrivant sur le package, ou avant de toucher au `ServiceProvider`, aux
> modèles, ou à l'installation.

---

## Ce que c'est

Réseau social + communication temps réel pour une application Laravel : murs, fils d'actualité,
commentaires, serveurs et rooms façon Discord, chat, visio/diffusion WebRTC, tableau blanc,
applications IA.

- **PHP 8.2+, Laravel 13.** Namespace PSR-4 `Dauvray\Socializer\` → `src/`.
- **Front Vue 3 + Pinia** (un îlot React pour Excalidraw), bundlé par le projet hôte.
- Auto-découvert via `extra.laravel.providers` → `Dauvray\Socializer\ServiceProvider`.
- **Pas de champ `version`** : versionné par branche git, requis en `dev-<branche>` via un dépôt VCS.

**Le package est développé directement dans `vendor/`.** Il a son propre dépôt git
(`vendor/dauvray/laravel-socializer/.git`) — les commits, branches et hooks sont les siens, pas ceux
du projet hôte.

---

## Trois bases de données

C'est la particularité structurante du package.

| Base | Ce qu'elle porte |
|---|---|
| **MySQL** | utilisateurs et groupes, via le package parent `laravel-estarter` |
| **MongoDB** | les contenus — `Post`, `Message`, `Page`, `Application`, `Alert` |
| **NebulaGraph** | **le graphe social** — relations, appartenances, permissions |

L'identifiant pivot est **`vertex_id` / `vertexid`** : la clé d'un nœud NebulaGraph, présente sur les
modèles Mongo comme dans les URLs.

Conséquence : **les « relations » ne sont presque jamais des relations Eloquent.** Elles vivent dans
deux traits de `src/app/Helpers/ModelTraits/` :

- **`Socializable`** (sur `App\Models\User` et `Group`) — `posts()` est la seule vraie `MorphMany` ;
  `wall()`, `feed()`, `conversations()`, `servers()`, `ownedServers()` interrogent Nebula et
  renvoient des collections. Il porte aussi **deux familles de gardes, à ne pas confondre** : les
  gardes de **canal de broadcast** (`canJoinchatRoom()`, `canJoinServer()`, `canJoinRoom()`,
  `isCreator()`, `isServerOwner()`, `isWallOwner()`, `isFeedOwner()`, `isRoomOwner()`) et le garde
  de **relation** `mayReach()`, posé sur les 5 routes de signalisation
  ([securite.md](../modules/webrtc2/securite.md)). Tous refusent par défaut quand le graphe ne
  répond pas. Plus l'accesseur pivot `getVertexIdAttribute()`.
- **`Commentable`** (sur tout modèle commentable) — `mustBeApprovedComment()`, accesseurs
  `getIsCommentableAttribute()`, `getVertexIdAttribute()`, `getNbCommentsAttribute()`.

`config/socializer.php` expose une map `models` (`post`, `message`, `page`, `alert`, `application`)
pour substituer les classes.

---

## Arborescence

```
laravel-socializer/
├── CLAUDE.md · README.md · docs/ · work/
├── hooks/pre-push            refuse de pousser une suite rouge (voir tests.md)
├── socializer.conf           modèle Nginx : SSL, proxy WebSocket Reverb, stream TURN
└── src/
    ├── ServiceProvider.php   point d'entrée unique
    ├── app/
    │   ├── console/Commands/ socializer:build · socializer:upgrade · 2 commandes Nebula
    │   ├── Events/           8 events broadcastés (posts, comments, likes, questionnaire)
    │   ├── Helpers/          helpers globaux + ControllerTraits/ Formaters/ ModelTraits/
    │   ├── Http/
    │   │   ├── Controllers/  Admin/ (CRUD Backpack) · Front/ (12 contrôleurs, minces)
    │   │   ├── Middleware/   CloseNebulaGraphSession
    │   │   └── Resources/    14 API Resources + Collections
    │   ├── Jobs/             fan-out posts/comments vers followers, bot
    │   ├── Listeners/        14 listeners — sync SQL/Mongo → graphe Nebula
    │   ├── Models/           8 modèles (voir ci-dessus)
    │   ├── Notifications/ · Providers/ · View/Components/
    │   └── Services/         13 services — LA couche logique métier
    ├── config/               socializer.php · modules.php (presets de rooms)
    ├── database/             8 migrations (SQL + collections Mongo + espace Nebula) + seeders
    ├── public/               assets publiés (css Excalidraw, placeholder, sons)
    ├── resources/
    │   ├── js/
    │   │   ├── echo.js                       config Echo/Reverb, copiée dans l'app
    │   │   ├── socializer/                   ★ le front du package
    │   │   ├── socializer_custom_elements/   points d'extension côté APP
    │   │   └── eblogger_custom_elements/     plugin GrapesJS « comments »
    │   ├── lang/fr/network.php
    │   ├── sass/socializer/                  _socializer.scss + components/ views/ widgets/
    │   └── views/components/
    └── routes/socializer/    routes.php (dispatch) · routes.private.php · routes.public.php
                              api.php · admin.php · channels.php · console.php
```

`src/resources/js/socializer/` en détail :

```
callbacks/     8 callbacks WebRTC (screen|stream|visio|vocal × player|playerData)
components/    19 dossiers de composants — voir modules/
composables/   transverses : useBreakpoints · useFileAttachments · useResizableElement · useStickyScroll
directives/    draggable · resizable · resizable_horizontal · resizable_vertical
routes/application.js         routes vue-router du package (lazy + meta.breadcrumb)
services/      FormsSetting · helpers · iframe-components
stores/        14 stores Pinia
```

---

## Le ServiceProvider

`src/ServiceProvider.php`, plus `src/app/Providers/SocializerEventServiceProvider.php`.

**`register()`** — merge de `config/socializer.php` (clé `socializer`) et `config/modules.php`
(clé `socializer.modules`) ; injection à la volée de deux disques filesystem (`protected`,
`networks`) ; deux singletons : `nebulaGraph` (`NebulaGraphConnection`) et `redisService`.

**`boot()`** — `Schema::defaultStringLength(191)` ; vues chargées **d'abord** depuis
`resource_path('views/vendor/socializer')` (overrides de l'app) puis depuis le package, namespace
`socializer::` ; routes chargées dans `$this->app->booted()` (`routes.php`, `channels.php`,
`api.php`, `console.php`, puis `admin.php` sous `['web','admin']`) ; middleware
`Dauvray\Estarter\...\UserActivity` poussé dans le groupe `web` ; namespace de composants Blade
`socializer` (`<x-socializer-comments-list />`) ; migrations **chargées, pas publiées** ;
traductions sous `socializer` ; auto-require de tous les `src/app/Helpers/*.php` ;
`View::composer('*')` injectant `$adminUser` dans **toutes** les vues.

**`publishes()`** — un seul groupe, sans tag : `resources/lang`, `config/socializer.php`,
`public/vendor`. **Ni les vues ni les migrations ne sont publiables.**

### `php artisan socializer:build`

Ce n'est **pas** du bundling — c'est l'installateur. Il enchaîne `vendor:publish`, `composer
dump-autoload`, `migrate`, `db:seed`, la copie des vues et de `echo.js` vers l'app, puis une série de
`replaceInfile()` qui **patchent les fichiers du projet hôte** (`config/estarter.php`,
`database/seeders/DatabaseSeeder.php`, `vite.config.js`…) autour de marqueurs
`// -- DO NOT DELETE THIS LINE : … can automatically be inserted here`. Ne pas supprimer ces
marqueurs dans l'app hôte.

Le bundling front, lui, appartient au projet hôte (`npm run dev` / `npm run build`).

---

## Dépendances implicites

Elles ne sont **pas** dans le `composer.json` mais sont requises :

- `Dauvray\Estarter\*` (middleware `UserActivity`, modèles parents `User`/`Group`/
  `NotificationTemplate`, `config('estarter.*')`, commande `EstarterPrepare`)
- Backpack (`backpack_auth()`, `Route::crud`)
- `mongodb/laravel-mongodb`, `cviebrock/eloquent-sluggable`, `innovation/laravel-formdesigner`

Le package fait partie d'une **famille** — `innovation/laravel-estarter`, `laravel-eblogger`,
`laravel-formdesigner`, `dauvray/laravel-eblogger` — avec laquelle il s'interpénètre par héritage de
modèles et de commandes, plugins GrapesJS et champs de formulaire custom.

**Infra au-delà de Laravel** : Redis, MongoDB, NebulaGraph, Reverb (WebSocket, proxifié — voir
`socializer.conf`) et un serveur TURN (proxy stream Nginx sur 3478).

---

## Points d'extension côté application

`src/resources/js/socializer_custom_elements/` — dupliqué à l'identique dans
`resources/js/socializer_custom_elements/` du projet hôte. C'est le mécanisme prévu pour que l'app
ajoute **agents IA** (`agents/settings.js`), **types de rooms** (`rooms/config.js` +
`rooms/components/*.vue`) et **routes** (`routes/application.js`) sans toucher au package.

Les contrôleurs sont eux aussi substituables : les routes les référencent **par config**
(`config('socializer.controllers_front.user').'@methode'`), jamais en dur.

---

## Zones mortes connues

À savoir pour ne pas y chercher quelque chose :

- `routes/socializer/admin.php` est **entièrement commenté** ; `console.php` est vide
- `config/socializer.php > table_names` est vide
- `SocializerUpgrade` (`socializer:upgrade`) a son corps quasi entièrement commenté
- `components/WebRTC/` est l'implémentation WebRTC **v1**, morte — voir
  [modules/webrtc2/INDEX.md](../modules/webrtc2/INDEX.md)
- les fichiers front préfixés `__` sont désactivés (`__StreamUserButton.vue`,
  `__AudioComponent copy.vue`)
