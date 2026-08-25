# Conventions de code

> **À quoi ça sert :** les conventions transverses du package — celles qu'on ne devine pas en
> lisant un fichier au hasard.
> **Quand le lire :** avant d'ajouter un fichier, un store, un modèle, une route ou du SCSS.

Les conventions **propres à WebRTC2** sont dans
[modules/webrtc2/architecture.md](../modules/webrtc2/architecture.md#conventions-de-code).

---

## PHP

**Namespaces en casse mixte, assumée.** Les segments reprennent les noms de dossiers en
minuscules : `Dauvray\Socializer\app\Models\Post`,
`Dauvray\Socializer\app\console\Commands\SocializerInstall`. Non-idiomatique PSR-4, mais
**systématique** — le reproduire, ne pas « corriger » au coup par coup.

**Modèles** — squelette commenté figé, blocs conservés même vides :
`GLOBAL VARIABLES` / `FUNCTIONS` / `RELATIONS` / `SCOPES` / `ACCESORS` *(sic)* / `MUTATORS`.

**Contrôleurs minces.** `Front/XxxController.php` et `Admin/XxxCrudController.php` (Backpack)
délèguent à `src/app/Services/*.php` — c'est là qu'est la logique. Réponses API normalisées par
`app/Http/Resources/`, avec la paire `Xxx.php` + `XxxCollection.php`.

**Événementiel** — `Events/` au participe passé (`PostCreatedEvent`, `CommentDeleted`,
`ItemLiked`), `Listeners/` en `XxxListener`, `Jobs/` à l'impératif (`SendPostToFollowers`).

**Routes** — verbes en **kebab-case anglais** (`/send-chat-message`, `/get-registered-servers`,
`/delete-server-room/{vertex_id}`), regroupés par module avec des bannières de commentaires. Les
contrôleurs sont référencés **par config**, jamais en dur :

```php
Route::post('/ma-route', config('socializer.controllers_front.user').'@maMethode')
    ->name('users.ma_route');
```

`routes.php` ne fait que dispatcher vers `routes.private.php` / `routes.public.php` selon
`config('estarter.routes_middlewares.classic.*')`.

**Configuration par `.env`** pour les IDs de formulaires : `SOCIALIZER_POST_FORM_ID`,
`SOCIALIZER_CREATE_ROOM_FORM_ID`, `SOCIALIZER_CREATE_SERVER_FORM_ID`,
`SOCIALIZER_ADD_ROOM_MODULE_ID`, `SOCIALIZER_APP_AI_DETAILS`.

---

## Front

### Structure d'un module

Un dossier par domaine sous `components/<Domaine>/`, avec la même sous-structure récurrente :

```
components/<Domaine>/
├── <Domaine>Component.vue   ou <Domaine>.vue      le composant racine
├── <domaine>.config.js      ou xxxSettings.js     configuration / presets
├── composables/             use*.js — logique extraite
├── utils/                   fonctions pures
├── widgets/                 sous-composants présentiels (+ widgets/partials/)
├── Exemples/                usages de référence, exécutables
└── __tests__/
```

⚠️ La casse de `widgets/` est **incohérente** : minuscule partout sauf `Users/Widgets/` et
`WebRTC2/Widgets/`. Suivre celle du dossier dans lequel on écrit.

### Nommage

- **PascalCase** pour les `.vue`, **camelCase** pour les `.js`
- composables préfixés `use*`
- fichiers préfixés `__` = **désactivés / mis de côté** (`__StreamUserButton.vue`)
- indentation à **4 espaces** dans les blocs `<script>`

### Vue 3

`<script setup>` majoritaire avec `defineProps` / `defineEmits`. Quelques reliquats en Options API
(`Feed/Feed.vue`) — ne pas les prendre pour modèle.

**Imports toujours via l'alias `~socializer`**, jamais en relatif profond. L'alias est défini côté
hôte dans `vite.config.js` **et** `vitest.config.js` — un import relatif casserait l'un des deux.
Alias disponibles : `~` (app), `~socializer`, `~estarter`, `~formdesigner`, `~eblogger`.

### Pinia — un pattern strict

```
stores/<nom>.js              defineStore('<nom>', { state, getters, actions })
stores/<nom>/state.js
stores/<nom>/getters.js
stores/<nom>/actions.js
```

Le fichier racine est fin : il importe les trois autres et les assemble. Les stores :
`applicationAI`, `chat`, `comments`, `community`, `conversations`, `feed`, `likes`, `peers`,
`peers2`, `server`, `socialUser`, `store`, `wall`.

⚠️ Les **getters Pinia sont auto-déballés** : la production lit `store.getConnections?.[room]` sans
`.value`. Un mock qui enveloppe un getter dans un `computed()` casse silencieusement — voir
[modules/webrtc2/tests.md](../modules/webrtc2/tests.md#pièges-de-mock).

### Routing

`routes/application.js` exporte un tableau de routes vue-router, avec `component: () => import(...)`
(lazy) et un `meta.breadcrumb` **obligatoire**. La base d'URL vient d'une globale
`router_base_url`.

---

## SCSS

`sass/socializer/` — partials `_nom.scss` classés en `components/`, `views/` et `widgets/`,
agrégés par `_socializer.scss`. Les fichiers du **projet hôte** sont notés `[host]` dans les docs
(ils vivent dans `resources/sass/` de l'app).

> ⚠️ **Le SCSS du paquet est COPIÉ dans l'hôte, et c'est la copie qui est compilée.**
> `SocializerInstall` recopie `src/resources/sass/socializer/` vers `resources/sass/` de l'app et
> ajoute un `@import` dans son `app.scss`. Le build de l'hôte ne lit donc **jamais** le SCSS du
> `vendor/` : modifier le paquet seul ne change rien à l'écran, et republier écrase les
> personnalisations de l'hôte.
>
> Toute retouche de style se fait donc **en deux endroits** — le paquet (pour que le correctif
> parte avec le tag) et la copie hôte (pour qu'il agisse ici) — après un `diff` des deux pour
> vérifier qu'elles n'ont pas divergé. C'est le pendant SCSS des vues vendor publiées.

### Ce qui est acquis, à ne pas régresser

- **HTML sémantique** : classes par intention (`message-inner`, `files`, `chat-messenger`), aucune
  classe utilitaire framework saupoudrée dans les `.vue`
- **Couplage Bootstrap isolé dans les partials SCSS** → un switch Bootstrap ↔ Tailwind reste faisable
  sans toucher les templates
- **Couche thème clair/sombre** via `[data-bs-theme]` dans `[host] estarter/_theme.scss`

### La règle `@extend`

> **`@extend %placeholder` est OK. `@extend .real-bootstrap-class` est à éliminer.**

`@extend .card` / `.d-flex` / `.shadow` est l'anti-pattern documenté (Harry Roberts, *Why You Should
Avoid Sass @extend*) : il réordonne le CSS de façon **non locale** (le sélecteur est inséré là où
Bootstrap définit `.card`, pas là où on écrit `@extend`), gonfle les listes de sélecteurs Bootstrap
livrées, hérite de contextes de spécificité imprévus, et **ne traverse pas les `@media`**.

Patron de migration, via les variables CSS que Bootstrap 5 expose toutes :

```scss
// avant
.message-inner { @extend .card; @extend .bg-secondary; @extend .shadow; @extend .border; }

// après
.message-inner {
    background-color: var(--bs-secondary);
    color: var(--bs-secondary-color);
    border: var(--bs-border-width) solid var(--bs-border-color);
    border-radius: var(--bs-card-border-radius);
    box-shadow: var(--bs-box-shadow);
}
```

**Exception** : les `@extend` de **classes maison** (`.bg-auto`, `.color-auto`,
`.bg-opacity-dark-*`, définies dans `[host] estarter/_theme.scss`) restent — c'est du couplage
projet, voulu. Idéalement à déclarer en `%placeholder` côté hôte quand elles ne servent qu'à être
étendues.

Le package **n'a pas de `_variables.scss` propre** : il dépend implicitement de celui du projet
hôte. Chantier ouvert, avec ses valeurs en dur : [`work/sass-todo.md`](../../work/sass-todo.md).

---

## i18n

**Convention non établie côté front — ne pas la supposer.** Aucun `$t()` / `trans()` / `__()` dans
les `.vue` : tous les libellés sont **codés en dur en français**, y compris les `meta.breadcrumb` de
`routes/application.js`.

Côté PHP, un seul fichier : `src/resources/lang/fr/network.php` (namespace `socializer::network`),
publié vers `resources/lang/vendor/socializer/fr/`. Il mélange libellés d'UI **et slugs de routes
traduits** (`routes.my_profile => 'mon-profil'`). Pas de locale `en`.

Écrire en français est donc cohérent avec l'existant ; introduire `$t()` est un chantier à part
entière, pas une amélioration au fil de l'eau.

---

## Documentation

Voir [ecrire-la-doc.md](../ecrire-la-doc.md). En deux lignes : le durable va dans `docs/`, le suivi
de chantier dans `work/`, et une case à cocher suffit à trancher.
