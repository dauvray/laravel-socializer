# TODO — Discipline SCSS (séparation style / contenu)

> **Chantier ouvert, non démarré.** Audit du 2026-05-27.
> Chemins relatifs à `src/resources/sass/socializer/`. Les fichiers du **projet hôte** sont
> préfixés `[host]` → ils vivent dans `resources/sass/` du projet consommateur.
>
> **La règle et les acquis sont dans
> [`docs/architecture/conventions.md`](../docs/architecture/conventions.md#scss).** Ce fichier ne
> porte que les items à traiter.
>
> Deux axes : (a) **centralisation des tokens** — couleurs et tailles en dur dispersées, ce qui
> casse le thème sombre — et (b) **sortie de l'anti-pattern `@extend .bootstrap-class`**.

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

La règle, ses quatre justifications et le patron de migration avant/après sont dans
[`docs/architecture/conventions.md § SCSS`](../docs/architecture/conventions.md#la-règle-extend).
Ici, seulement les cibles.

- [ ] **Migrer `.message-inner`** (`_socializer.scss:81-89`) — c'est le cas de référence,
      il sert de patron pour tous les autres.
- [ ] **Étendre le patron aux autres `@extend` de classes Bootstrap** de ce dossier
      (~40 occurrences : `.card`, `.btn`, `.d-flex`, `.shadow`, `.rounded`, `.border`,
      `.badge`, `.btn-group`, `.text-bg-*`).
- [ ] **Déclarer en `%placeholder` côté hôte** les classes maison qui ne servent qu'à être
      étendues (`.bg-auto`, `.color-auto`, `.bg-opacity-dark-*` dans
      `[host] estarter/_theme.scss`). Leurs `@extend` restent — c'est du couplage projet,
      voulu.

## 🟡 Priorité basse — dette de spécificité

- [ ] **`!important` systématique** dans `[host] estarter/_theme.scss`
      (`bg-opacity-dark-*`) → symptôme de lutte de spécificité avec Bootstrap ;
      réévaluer après centralisation et migration `@extend` (devrait largement
      diminuer).
