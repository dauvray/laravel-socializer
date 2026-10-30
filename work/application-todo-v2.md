# Application v2 — Todo

> La **deuxième partie** du module Application : faire de la création d'apps par les utilisateurs
> (« vibe coding ») un vrai chantier. La première partie, [`application-todo.md`](application-todo.md),
> corrige le module tel qu'il tourne et **prépare** celle-ci : rien ici ne démarre avant elle.
>
> Ce fichier n'est **pas** l'ancien `application-v2-todo.md`, retiré le 30/10/2026 (`571b1ea`) pour
> repartir de zéro. Il part de la vision apportée par David le même jour, et de ce que le code y
> répond.
>
> Effort : `[S]` `[M]` `[L]`

---

## Le point de départ : une vision, et ce que le code y répond

La vision tient en quatre documents de David, **hors dépôt** (`PROJECT_CONTEXT.md`,
`ARCHITECTURE_DECISIONS.json`, `CONVERSATION_HISTORY.md`, `AGENT_INSTRUCTIONS.md`, 30/10/2026).
Trois choix y sont **confirmés** : architecture hybride (frontend autonome dans l'iframe, services
mutualisés de la plateforme, backends propres à une app plus tard et isolés), frontière
`postMessage` conservée, projets multi-fichiers avec imports. Tout le reste — VFS, SDK, bridge RPC
versionné, esbuild-wasm, modèle de données, feuille de route en cinq phases — y est **proposé**, pas
décidé.

Ce que le code répond à ces documents, lu le 30/10/2026 :

- **Il n'existe aucune compilation SFC.** `code` est un objet JSON — `template`, `script`, `style`,
  `translations`, `dependencies`. `script` est un littéral d'objet Options API collé par
  `String.replace` dans `template.html`, et Vue global, chargé depuis unpkg, compile le template
  chez chaque membre à chaque ouverture : ni `import`, ni `<script setup>`, ni artefact. « Rester
  compatible avec les SFC existants », c'est rester compatible avec **ce format JSON**.
- **Stockage** : Mongo `applications` (`code`, `infos`) et un sommet NebulaGraph ; les données de
  l'app dans un document Mongo `page`. **Une app par salon.** Le modèle de neuf tables proposé
  ignore la tri-persistance et le graphe.
- **Pont** : trois actions sans version ni identifiant de corrélation — `database`, `broadcast`,
  `resize_iframe`. Ce sont les germes des capacités `data`, `realtime` et, avec `users` et `room`
  injectés au démarrage, `identity`.
- **Dépendances** : liste blanche de CDN dans `Application/settings.js`, versions non épinglées
  (`vue@3`, `axios`, `chart.js`).
- **IA** : aucun LLM dans la boucle Application (section 🟢). Le patron IA du paquet est celui des
  Pages et des Questionnaires : Laravel poste au webhook n8n d'un utilisateur-bot
  (`extras.webhook_url`), n8n rappelle Laravel, qui prévient l'auteur par Reverb
  (`broadcastEventbusNotification`, type `prompt_request_completed`).
- Les documents annoncent **Laravel 12** : c'est Laravel 13. PeerJS est toujours là, sous WebRTC2.

---

## Décisions de David du 30/10/2026

- **Qui écrit le code d'une app : tout utilisateur autorisé, pas seulement son créateur.**
  « Autorisé » = titulaire d'une permission accordée par un admin **et** inscrit au salon de l'app.
  Le propriétaire du serveur est autorisé d'office. La garde se pose dès la partie 1, selon cette
  règle : la décision, ses implications et ce qu'elle laisse ouvert sont dans
  [`application-todo.md`](application-todo.md), première section.
- **Un historique léger** — quelques versions précédentes seulement, forme non figée — existe avant
  que la permission soit accordée : il se fait dans la partie 1, section 🟠 « Un écrasement n'a pas
  de retour arrière ».
- **L'iframe s'isole dès la partie 1**, par une origine opaque (`srcdoc` sans `allow-same-origin`),
  avant que la permission soit accordée — recommandation suivie par David : section 🔴 « Le code
  d'une app s'exécute… » d'`application-todo.md`.
- **Une origine dédiée est obtenable** : un sous-domaine, sur l'infra GHU. Elle n'est **pas**
  requise pour isoler — section suivante.
- **La boucle de génération n'est pas arrêtée** — section « Ouvert ».

---

## Une origine dédiée — seulement sur besoin

L'origine opaque de la partie 1 suffit à isoler, et une CSP propre aux apps passe par une `<meta>`
en tête du `srcdoc` — mesuré le 30/10, avec sa limite : aucune CSP ne couvre la navigation
(`application-todo.md`, section 🔴 « Le code d'une app s'exécute… »). Une origine dédiée ne se
justifie que si une app a besoin de ce qu'une origine opaque n'a pas : un **stockage navigateur** à
elle (`localStorage`, IndexedDB) ou un **Service Worker**. Les projets multi-fichiers n'en ont pas besoin : le code
compilé s'injecte dans le `srcdoc`, ou se charge depuis l'hôte avec un en-tête CORS (spécification,
non rejoué).

Si le besoin apparaît :

- ⚠️ **Un sous-domaine est une autre ORIGINE mais le même SITE.** La session de l'hôte est en
  `SameSite=Lax` (`config/session.php`, pas de surcharge dans le `.env` du bac à sable). Mesuré le
  30/10 par une session paire (page synthétique, Chromium 149 et Firefox 151) : avec
  `allow-same-origin` sur un sous-domaine, un `fetch` en `credentials: 'include'` (`GET` comme
  `POST`) et une image emportent la session ; un `fetch` par défaut, non. La réponse reste
  illisible sans CORS, mais l'effet de bord a lieu. Ce qui le bloque est le CSRF de Laravel 13,
  `PreventRequestForgery`, qui ne laisse passer une requête `same-site` que si `allowSameSite()` est
  activé — faux par défaut, et **c'est le levier à ne jamais activer**. Et une route `GET` qui écrit
  n'a pas de CSRF : `routes.private.php` en compte trois qui suppriment. Stockage et Service Worker
  exigent `allow-same-origin` : sur un sous-domaine, le piège est donc entier. Un domaine
  enregistrable distinct l'évite.
- Son URL est une valeur de déploiement : PHP, jamais `VITE_*`.

- [ ] Ne l'ouvrir que sur un besoin nommé ; alors trancher sous-domaine contre domaine distinct.

---

## Ouvert — à trancher par David

- [ ] **Où tourne la boucle de génération** : côté serveur (n8n, comme Pages et Questionnaires) ou
      dans le navigateur de l'auteur ? Elle tranche **où compiler**. La boucle que vise la vision
      (compiler → renvoyer les erreurs au LLM → corriger) tourne sans navigateur si l'orchestrateur
      est côté serveur ; une compilation dans le navigateur la lie à un onglet ouvert.

---

## Propositions de la session du 30/10/2026 — non décidées

- Compiler **une fois, à l'enregistrement**, et servir un artefact, au lieu de recompiler chez
  chaque membre. Un compilateur côté serveur (Node isolé, `@vue/compiler-sfc` + esbuild) plutôt
  qu'esbuild-wasm, si la boucle de génération est côté serveur.
- Un premier jalon petit : un projet = `{ manifest, files: { chemin: contenu } }` dans le document
  `applications.code` existant — c'est déjà un VFS ; l'abstraire du stockage quand un second
  stockage existera. L'ancien format se convertit presque mécaniquement en un projet d'un seul
  `App.vue` : un seul chargeur à maintenir.
- Un SDK v0 = un petit module injecté dans l'iframe, qui formalise les trois actions existantes avec
  une version et un identifiant de corrélation ; les anciennes actions restent des alias.
- Ne pas bâtir `platform.data` sur `databaseAction` tel qu'il est : la partie 1 le rend atomique
  ([`application-todo.md`](application-todo.md), section 🟠 `databaseAction`).

---

## 🟢 Deux défauts relevés le 30/10/2026, rejoués en relecture `[S]`

Ils restent ici parce que les corriger ne prépare pas cette partie : la partie 2 remplace l'un et
l'autre. Le troisième relevé le même jour, `databaseAction`, prépare la capacité `data` : il est
dans [`application-todo.md`](application-todo.md).

- **Le prompt de la modale n'atteint aucun LLM.** L'onglet code d'`ApplicationModale.vue` monte le
  `PromptWidget` de formdesigner — champ et bouton « Envoyer » toujours affichés — et branche
  `@submit-prompt` sur `onSendAppDetails`, le handler du questionnaire, qui attend un `FormData`.
  Le widget émet `{ prompt, promptId }` et `formData.get` lève. La suite dépend du build — rejoué
  le 30/10 en relecture (Vue 3.5, happy-dom) : en **développement**, l'erreur remonte du `$emit`
  dans `onSubmitPrompt`, le texte reste dans le champ et rien ne se passe, sauf une erreur en
  console ; en **production**, un `console.error`, puis le champ se vide et le widget reste en
  chargement, puisqu'aucun `prompt_request_completed` ne viendra. Ni l'hôte ni le socle ne posent
  d'`app.config.errorHandler`. Aucun service serveur n'existe pour ce prompt.
- **`resize_iframe` n'a aucun effet** : `style.height = Number(data.height)` pose une longueur sans
  unité, ignorée hors mode quirks — mesuré le 30/10 dans les deux navigateurs (la valeur reste
  `100%` ; en mode quirks, elle passerait), et la page hôte sert `<!doctype html>`. L'iframe garde son `height: 100%` en ligne ; de ce message, seul
  `componentLoaded` sert.

- [ ] Prompt : le brancher est ce chantier ; d'ici là, retirer le champ ou le laisser — décision de
      David.
- [ ] `resize_iframe` : ajouter l'unité, ou retirer l'affectation si la hauteur 100 % est voulue.
