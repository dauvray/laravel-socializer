# TODO — Discipline SCSS (séparation style / contenu)

> Audit du 2026-05-27. Chemins relatifs à ce dossier
> (`vendor/dauvray/laravel-socializer/src/resources/sass/socializer/`).
> Les fichiers du **projet hôte** sont préfixés `[host]` → ils vivent dans
> `resources/sass/` du projet qui consomme le package.
>
> L'architecture est saine (HTML sémantique + couplage Bootstrap isolé dans les
> partials). Le chantier porte sur (a) la **centralisation des tokens** — couleurs
> et tailles aujourd'hui en dur dispersées, ce qui casse le thème sombre — et
> (b) la **sortie de l'anti-pattern `@extend .bootstrap-class`**.

## 🔴 Priorité haute — casse le thème sombre

- [ ] **`date-separator` illisible en dark mode** — `components/_chat.scss:36-49`
      `#e0e0e0`, `#666`, `#f5f5f5` en dur, ignorent `[data-bs-theme="dark"]`.
      → utiliser `.color-auto` / `.bg-auto` (définies côté hôte) ou des variables
      de thème.
- [ ] **Fonds `rgba(0,0,0,…)` en dur** — `components/_chat.scss:25,69,103,166`
      → remplacer par les helpers existants `.bg-opacity-dark-*`
      (définis dans `[host] estarter/_theme.scss`).

## 🟠 Priorité moyenne — centraliser les tokens

- [ ] **Créer une vraie source de vérité pour les tokens du package.**
      Aujourd'hui le package n'a pas de `_variables.scss` propre ; il dépend
      implicitement de celui du projet hôte (`[host] _variables.scss`, qui ne
      contient que grille + police). Deux options :
  - option A : exposer un `_variables.scss` dans ce package (recommandé pour la
    réutilisabilité) avec couleurs et tailles spécifiques au socializer ;
  - option B : remonter ces tokens côté hôte si on veut garder le package
    "sans tokens propres".
- [ ] **Couleurs récurrentes à variabiliser** (gris de séparateurs, fonds
      translucides) — voir `components/_chat.scss:25-49`.
- [ ] **Tailles de layout en dur** :
      `68vh` (`components/_chat.scss:15-16`),
      `top: -45px` (`components/_chat.scss:110`),
      `--messenger-height` (déjà en custom-prop, OK),
      largeurs `300px`/`450px` (`_socializer.scss:44,253`).
- [ ] **URL d'image externe en dur** — `components/_chat.scss:18`
      `user-images.githubusercontent.com/...` en prod → rapatrier l'asset dans
      les ressources du package, ou en variable.
- [ ] **Audit complet des valeurs codées en dur** (~70 occurrences `#hex` /
      `rgba` / `px` / `vh` dans ce dossier) → lister et arbitrer lesquelles
      deviennent des variables.

## 🟠 Priorité moyenne — sortir des `@extend .bootstrap-class`

Architecture (HTML sémantique + couplage Bootstrap concentré en SCSS) bonne,
mais `@extend .card` / `@extend .d-flex` / `@extend .shadow` est l'anti-pattern
documenté (Harry Roberts, "Why You Should Avoid Sass @extend") :

- réordonne le CSS de manière non locale (ton sélecteur est inséré là où
  Bootstrap définit `.card`, pas là où tu écris `@extend`) ;
- gonfle les listes de sélecteurs Bootstrap (`.d-flex, .chat-messenger-writting ul,
  .message-input-container, …`) → poids inutile dans le CSS livré ;
- hérite de contextes de spécificité imprévus ;
- ne traverse pas les `@media`.

**Règle simple :** `@extend %placeholder` reste OK, `@extend .real-bootstrap-class`
est à éliminer.

- [ ] **Migrer `.message-inner`** (`_socializer.scss:81-89`) — sert de patron
      pour les autres.

  Avant :
  ```scss
  .message-inner {
      @extend .card;
      @extend .bg-secondary;
      @extend .shadow;
      @extend .border;
      &.is-me { @extend .bg-primary; }
  }
  ```

  Après (variables CSS Bootstrap, recommandé — Bootstrap 5 les expose toutes) :
  ```scss
  .message-inner {
      background-color: var(--bs-secondary);
      color: var(--bs-secondary-color);
      border: var(--bs-border-width) solid var(--bs-border-color);
      border-radius: var(--bs-card-border-radius);
      box-shadow: var(--bs-box-shadow);

      &.is-me {
          background-color: var(--bs-primary);
          color: var(--bs-primary-color);
      }
  }
  ```

  Alternative factorisée (mixin local) :
  ```scss
  @mixin card-look {
      border: var(--bs-border-width) solid var(--bs-border-color);
      border-radius: var(--bs-card-border-radius);
      box-shadow: var(--bs-box-shadow);
  }
  .message-inner {
      @include card-look;
      background-color: var(--bs-secondary);
      &.is-me { background-color: var(--bs-primary); }
  }
  ```

- [ ] **Étendre le patron aux autres `@extend` de classes Bootstrap** dans ce
      dossier (~40 occurrences : `.card`, `.btn`, `.d-flex`, `.shadow`,
      `.rounded`, `.border`, `.badge`, `.btn-group`, `.text-bg-*`, etc.).
- [ ] **Garder les `@extend` de classes maison** (`.bg-auto`, `.color-auto`,
      `.bg-opacity-dark-*` — définies dans `[host] estarter/_theme.scss`) — ce
      sont des classes du projet, le couplage est voulu. Idéalement, les
      déclarer en `%placeholder` côté hôte quand elles ne servent qu'à être
      étendues.

## 🟡 Priorité basse — dette de spécificité

- [ ] **`!important` systématique** dans `[host] estarter/_theme.scss`
      (`bg-opacity-dark-*`) → symptôme de lutte de spécificité avec Bootstrap ;
      réévaluer après centralisation et migration `@extend` (devrait largement
      diminuer).

## ✅ Acquis (ne pas régresser)

- HTML sémantique : classes par intention (`message-inner`, `files`,
  `chat-messenger`), aucune classe utilitaire framework saupoudrée dans les
  `.vue`.
- Couplage Bootstrap isolé dans les partials SCSS → un switch Bootstrap↔Tailwind
  reste faisable sans toucher les templates (une fois la migration `@extend`
  faite, ce sera encore plus propre).
- Couche thème clair/sombre via `[data-bs-theme]` dans
  `[host] estarter/_theme.scss`.
