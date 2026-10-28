# TODO — Application v2 : apps multi-fichiers et éditeur de vibe coding

> **Chantier ouvert le 28/10/2026, non démarré.** But : qu'un salon « Application » serve une app
> Vue **multi-fichiers** avec des `import`, et que des **auteurs autorisés** la construisent dans un
> **éditeur de vibe coding** : un fil de conversation avec un agent codeur, **et** l'édition à la
> main, les deux dans la même modale. L'iframe sandboxée, le `postMessage` et la sauvegarde en base
> restent le principe.
>
> Le plan a été cadré en huit questions, puis relu deux fois par mesure (un sous-agent, une session
> paire) : trois affirmations sur quatre du premier plan étaient fausses, dont la plus vendue. Ce
> fichier ne porte que ce qui a survécu, et les mesures qui bornent chaque lot. Les faits durables
> remontent dans `docs/modules/application/` au fil des lots, selon
> [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md).

---

## Les décisions, et ce qui est abandonné

| # | Sujet | Décision |
|---|---|---|
| 1 | Visibilité | Deux paliers, **un seul moteur d'exécution** : le brouillon est vu des auteurs, la version publiée des membres, les deux dans le même bac à sable |
| 2 | Compilation | Serveur, fichier par fichier, compilateur SFC de Vue dans un script Node autonome, ESM natif et import map dans l'iframe, **sans bundler** |
| 3 | Kit | **Aucun composant maison dans l'iframe.** Le runtime est Vue ESM, vue-i18n ESM, Bootstrap, et le pont `@app/runtime`. Un modèle écrit les widgets ; ce qu'il ne sait pas écrire, c'est le pont |
| 4 | Agent | Boucle à outils dans un job Laravel, copie de travail, brouillon remplacé seulement sur compilation propre, progression par Reverb |
| 5 | Modèle | Client agnostique : pilote compatible OpenAI (DeepSeek, vLLM, ollama, Mistral, OpenAI) en premier, Anthropic en second ; tolérant à un appel d'outils peu fiable, repli en actions JSON |
| 6 | Droits | Permission spatie globale **et** arête `author_of` dans le graphe, posée par le propriétaire du serveur ; garde `isRoomAuthor` |
| 7 | Isolation | `sandbox="allow-scripts allow-forms allow-modals"` **sans** `allow-same-origin`, CSP stricte, fichiers sous URL à jeton, messages filtrés par fenêtre émettrice. Pas de sous-domaine |
| 8 | Expérience | Fil de conversation dédié dans la modale, arbre de fichiers et éditeur, rechargement du brouillon à chaque compilation propre |

**Abandonné le 28/10, décision de David : le kit de composants maison** (estarter, formdesigner,
socializer dans l'iframe, transport injectable, catalogue dérivé, verbe `api` à capacités). Mesuré
avant d'abandonner : fermeture d'imports de 176 fichiers, `localStorage` lu **à l'import** de
`Modal.vue` (`estarter/stores/application/state.js:1`), `Echo` et `$router` en dur, `window.open`
sans `allow-popups`. Ne pas le rouvrir sans ces chiffres sous les yeux.

---

## Les mesures qui bornent le chantier (28/10/2026)

Toutes rejouables. Les échantillons du compilateur sont dans
`/var/www/estarter-test/storage/app/relecture-application/` (hors git, à recréer au lot 2.2).

| Fait | Mesure | Conséquence |
|---|---|---|
| Compilateur SFC en script autonome | bundle esbuild 1,4 Mo ; dans le conteneur `laravel`, sans `node_modules` : 20 fichiers 258-284 ms mur (116-119 ms en processus), 100 fichiers 416-479 ms, 300 fichiers 711-781 ms | un processus par sauvegarde, pas de service persistant |
| Sans accès disque | `strace` : aucune écriture hors stdout ; `node --experimental-permission --allow-fs-read=<script> <script>` passe, **sans `--allow-fs-read` sur son propre chemin Node refuse de lire le script** | le service PHP porte le drapeau ET le chemin ; `--permission` à partir de Node 22 |
| Moteurs de template optionnels | 14 `require` nus restent dans le bundle, dans des `try` | inatteignables parce que le script refuse `lang` ≠ js/html/css **avant** le compilateur : ce filtre est la garantie, pas le bundle |
| Lignes des erreurs | justes pour `.js` et pour le template d'un `<script setup>` ; **fausses** pour une erreur dans `<script>` (10 pour 18) et pour un import refusé dans un `.vue` (6 pour 10, ligne du code compilé) ; balise non fermée ⇒ l'ancêtre | 2.2 : décalage du bloc, analyse des imports sur la **source** |
| CORS | l'hôte n'a pas de `config/cors.php` ; défaut du framework `paths = ['api/*', 'sanctum/csrf-cookie']` ; routes socializer sans préfixe | depuis une origine opaque, chaque import ESM part avec `Origin: null` : les routes de fichiers et de runtime doivent répondre `Access-Control-Allow-Origin: *` |
| CSP dans une origine opaque | fait de spécification | `'self'` ne désigne rien : host-source explicite ; l'import map inline est régie par `script-src` : nonce |
| Pont parent → iframe | `ApplicationComponent.vue:311` passe `window.location.origin` comme **replacer** de `JSON.stringify`, pas comme cible | marche aujourd'hui par hasard en same-origin ; vers une origine opaque rien n'est livré, sans erreur ⇒ `postMessage(message, '*')` |
| Pont iframe → parent | 5 apps sur 5 (4 `Exemples/*.txt` + l'unique document Mongo) postent avec `window.location.origin`, qui vaut `"null"` dans une origine opaque | la migration **réécrit** ces idiomes ; une app non convertible reste sur le rendu hérité |
| Worker de queue | un seul `queue:work`, sans `--timeout` (défaut 60 s), pcntl actif, `QUEUE_CONNECTION=database`, `retry_after` 90 s | un job d'agent est tué puis rejoué depuis le début ; il faut `$timeout`, `tries = 1`, unicité par fil, file `agent` **et un second worker** |
| Droits aujourd'hui | `iaApp.save`, `iaApp.database`, `iaApp.load`, `store.load.applications` sous `auth` seul ; `loadApplicationIA` interpole `$room_id` dans le nGQL ; `Store::getApplications` a un `dd()` qui rend les sommets des créateurs | tout connecté lit et réécrit le code de n'importe quelle app, qui tourne same-origin chez chaque membre : **le lot 1 est dû indépendamment du projet** |
| Apps existantes | 1 document `application` dans cette base ; `code` est un septuplet (`name`, `dependencies`, `template`, `script`, `style`, `translations`, `metadata`) ; deux formats de traductions (tableau en base, chaînes JSON dans les exemples) ; `dependencies` résout en **globaux CDN** (`new bootstrap.Modal`) | l'import map ne crée aucun global : table de correspondance et exposition de `bootstrap` par le runtime |
| Défauts du composant actuel | `settings.js` : une dépendance à valeur tableau ne produit aucune balise (le `return` du `forEach` est perdu) ; la clé `ag grid` est inatteignable après `replace(" ", ".")` | disparaissent avec `settings.js` au lot 2 |
| Couplage compilateur / runtime | aucun des trois paquets maison n'a de `package.json` ; l'hôte déclare `vue` en `^3.4.24` ; `vue-i18n` absent de `node_modules` ; `esbuild` 0.25.3 et `@babel/parser` 7.28.5 transitifs seulement | compilateur **et** runtime construits ensemble au build de l'hôte, rien de binaire dans le paquet |
| Navigateur | aucun sur cet hôte | tout fait navigateur se mesure depuis un poste client, au lot 0 |

---

## Décisions qui appartiennent à David

- [ ] **Rendu hérité.** Tant qu'un salon à app monofichier non portée existe, ses auteurs sont de
      confiance au niveau de l'origine de l'hôte : leur code tourne same-origin chez chaque membre.
      Le lot 1 restreint *qui écrit*, pas *où le code s'exécute*. Alternative : porter les apps à la
      main au lot 2 et ne pas construire de rendu hérité. **La question qui tranche : combien
      d'apps en production ?**
- [ ] **Trois dépendances** à approuver dans le `package.json` de l'hôte, et à refaire par projet
      consommateur : `vue-i18n` (absent), `esbuild` et `@babel/parser` en explicite.
- [ ] **Le modèle** et ses clés pour le lot 3, et qui paie le jeton.
- [ ] **Un second worker** dans le `docker-compose` de l'hôte pour la file `agent` (lot 3.3).

---

## Règles du chantier

- **Une tâche = un commit**, par chemins explicites, jamais `git commit -a` : le paquet vit en place
  dans `vendor/` et plusieurs sessions y écrivent. Les tâches qui touchent l'hôte (compose,
  `package.json`, marqueurs Vite) sont des commits **du dépôt hôte**, nommés comme tels.
- **Trois volets par tâche, Code · Doc · Tests**, et une tâche n'est finie qu'aux trois. Quand le
  volet tests est impossible (navigateur, transport réel), il nomme la vérification manuelle qui le
  remplace, jamais une case cochée par défaut. Doctrine : `work/README.md` du projet hôte.
- **Relecture avant commit** par une seconde session, sur les affirmations du lot, pas sur le
  style. Le relecteur reçoit au plus trois ou quatre affirmations classées par gravité.
- **Pas de Pint** sur ce paquet. Tests JS depuis la racine de l'hôte, tests PHP depuis le paquet.
- **Ne jamais conclure « livré » depuis `vendor/`** : le paquet n'a aucun tag. Chaque lot clos le
  dit explicitement dans sa ligne.
- Les numéros de tâche sont des identifiants, pas un ordre strict : **l'ordre est celui des
  dépendances**, ci-dessous.

---

## Dépendances entre lots

```
Lot 1 (droits)  ──┐
                  ├──► Lot 2 (exécution multi-fichiers, éditeur manuel) ──► Lot 3 (agent, fil) ──► pilotes ──► Lot 5 (clôture)
Lot 0 (maquette) ─┘                                                      └─► Lot 4 (versions, store)
```

- **Lot 1 et lot 0 sont indépendants** et peuvent se mener de front. Le lot 1 est livrable seul.
- **Le lot 2 ne commence pas avant le go du lot 0** : si le mécanisme ne tient pas dans un
  navigateur, le plan se revoit avant d'avoir coûté.
- **Le lot 3 ne commence pas avant que le lot 2 ait un auteur pilote** qui fabrique ses fichiers
  avec un outil d'IA externe et les colle dans l'éditeur. Si aucune app ne naît, le lot 3 attend.
- Le lot 4 ne bloque rien : la publication minimale est dans le lot 2.

---

## Lot 1 — Droits et injection, sur le module actuel

Dû indépendamment du projet. Tout ce lot se livre sur l'app monofichier d'aujourd'hui.

### 1.1 L'arête `author_of` et la permission

- Déclarer l'arête dans `config/socializer.php` (`nebulagraph.edges`), avec sa création
  (`CREATE EDGE IF NOT EXISTS`, mécanisme de `NebulaGraphConnection`). Déclarer la permission
  `socializer.application.author` dans le seeder des permissions.
- Dépend de : rien.
- [ ] Code — config, migration nebula, seeder.
- [ ] Doc — `docs/modules/application/droits.md` (nouveau) : la règle « permission ET arête », et
      pourquoi un double verrou (l'administration contrôle qui *peut* être auteur, le propriétaire
      du serveur contrôle qui *l'est* sur son salon).
- [ ] Tests — PHPUnit : l'arête existe après le seeder.
- Commit : `feat(application): déclarer l'arête author_of et la permission d'auteur`

### 1.2 La garde `isRoomAuthor`

- Dans `Socializable`, à côté de `isRoomOwner` : vrai si propriétaire du serveur, ou si permission
  **et** arête vers ce salon. Fail-closed sur panne du graphe, comme les cinq gardes voisines
  (`_refusSansReponse`).
- Dépend de : 1.1.
- [ ] Code — `Socializable.php`.
- [ ] Doc — `droits.md`, section « la garde ».
- [ ] Tests — PHPUnit sur le modèle des gardes existantes : propriétaire, auteur, permission sans
      arête, arête sans permission, graphe en panne. **Rouges d'abord.**
- Commit : `feat(application): garde isRoomAuthor, double verrou permission et arête`

### 1.3 Identifiants de sommets validés avant tout nGQL

- Un helper `assertVertexId()` (format exact des identifiants produits par `uniqidReal()`), appelé
  dans `ApplicationIA::loadApplicationIA` avant l'interpolation, et dans toute méthode du service
  qui reçoit un identifiant de la requête. Chercher les autres interpolations du même service et du
  `Store`.
- Dépend de : rien (peut précéder 1.1).
- [ ] Code — helper + appels.
- [ ] Doc — `droits.md`, « les identifiants viennent du client, jamais interpolés tels quels ».
- [ ] Tests — PHPUnit : un identifiant forgé est refusé avant toute requête.
- Commit : `fix(application): valider les identifiants de sommets avant toute requête nGQL`

### 1.4 Les quatre points d'entrée gardés, et le `dd()` retiré

- `iaApp.save`, `iaApp.database` : auteur du salon qui porte l'app. `iaApp.load` : membre du salon
  (la lecture suit la visibilité du salon). `store.load.applications` : connecté, mais ne rend que
  `infos` et `vertexid`, jamais les sommets utilisateur ; `dd()` retiré. Les trois commentaires
  `todo a protéger` disparaissent avec leurs gardes.
- Dépend de : 1.2, 1.3.
- [ ] Code — `ApplicationIA.php`, `Store.php`, `ApplicationIAController.php`.
- [ ] Doc — `droits.md`, la table route → garde.
- [ ] Tests — PHPUnit par route : connecté non membre, membre non auteur, auteur. **Rouges
      d'abord** : aujourd'hui tout passe.
- Commit : `fix(application): garder les quatre routes du module, retirer le dd() du store`

### 1.5 Désigner les auteurs depuis les réglages du salon

- Dans les réglages d'un salon `application` (`roomSettings.js`, `SettingsModal`), le propriétaire
  choisit des membres comme auteurs ; route et service qui posent ou retirent l'arête. Dans
  `Room.vue`, `editable` devient « propriétaire ou auteur », calculé **côté serveur** et rendu avec
  le salon, jamais déduit côté client.
- Dépend de : 1.4.
- [ ] Code — réglages, route, `Room.vue`.
- [ ] Doc — `droits.md`, le parcours.
- [ ] Tests — PHPUnit sur la route ; Vitest sur le réglage.
- Commit : `feat(application): le propriétaire désigne les auteurs d'un salon`

**Clôture du lot 1** : ligne du `work/README.md` mise à jour, et la phrase « rien n'est livré tant
qu'aucun tag ne contient ce commit ».

---

## Lot 0 — Maquette navigateur : le mécanisme doit tourner une fois avant le lot 2

Volet code vide ou presque : le livrable est une **mesure**, consignée ici. Aucun navigateur sur
l'hôte : depuis un poste client, contre le serveur de dev.

### 0.1 Le compilateur corrigé sur ses lignes

- Sur la maquette hors git : décalage du bloc `<script>`, analyse des imports sur le bloc source,
  refus d'un `.css` importé depuis un `.js`, ligne non nulle pour un `lang` refusé. Rejouer
  `sample-broken.json` et le cas « erreur de syntaxe dans un `<script setup>` placé **après** le
  template », non vérifié par les relectures.
- Dépend de : rien.
- [ ] Code — hors git, la maquette.
- [ ] Doc — ici, la table des lignes attendues et rendues.
- [ ] Tests — la rejoue sur les deux échantillons.
- Commit : `docs(work): lignes du compilateur remesurées` (ce fichier seul)

### 0.2 La page de test de l'origine opaque

- Une page sous `tests/visual/application-sandbox/` (l'endroit du paquet pour ce qui ne se mesure
  qu'à la main), servie par une route de dev : iframe `sandbox` sans `allow-same-origin`, import map
  inline sous nonce, CSP à host-source explicite, Vue ESM chargé depuis une route **avec** CORS, un
  module d'app de trois fichiers compilés par la maquette, et une poignée de main `ready`/`init`.
- À mesurer, dans cet ordre, parce que chaque fait masque le suivant : un module servi **sans**
  `Access-Control-Allow-Origin` est refusé ; un import map sans nonce est bloqué ; `localStorage`
  lève une `SecurityError` ; `postMessage(…, "null")` lève ; `window.open` est bloqué ; le parent
  reçoit le message avec `event.origin === "null"` et `event.source === iframe.contentWindow`.
- Dépend de : 0.1.
- [ ] Code — la page et sa route de dev.
- [ ] Doc — ici, la grille remplie, navigateur et version.
- [ ] Tests — manuel par nature ; la page reste comme contrôle rejouable.
- Commit : `test(application): page de contrôle manuel du sandbox à origine opaque`

### 0.3 Go / no-go

- [ ] Si les six faits tiennent : lot 2. Sinon, écrire ici ce qui ne tient pas et revoir
      l'isolation avant toute ligne du lot 2.

---

## Lot 2 — Exécution multi-fichiers et éditeur manuel

À la fin de ce lot, un auteur édite des fichiers à la main, compile, voit ses erreurs, et publie
une première version visible des membres. **C'est le lot du pilote sans agent.**

### 2.1 Le modèle de données

- `application` gagne `manifest` (entrée, dépendances, version du runtime), `draft` (fichiers
  source, fichiers compilés, CSS agrégé, erreurs, jeton de révision), `published` (numéro courant).
  Collections `application_versions`, `application_checkpoints`, `application_threads`. `code`
  reste tel quel tant que le rendu hérité existe.
- Dépend de : 0.3.
- [ ] Code — modèles Mongo, index sur `vertexid` et jeton.
- [ ] Doc — `docs/modules/application/donnees.md` : qui possède quoi, et pourquoi trois collections
      (limite de taille d'un document, immuabilité des versions).
- [ ] Tests — PHPUnit sur les modèles.
- Commit : `feat(application): modèle de données du système de fichiers virtuel`

### 2.2 Le compilateur dans le paquet

- Source du script dans `src/resources/compiler/`, script de build esbuild, et service PHP
  `ApplicationCompiler` : processus borné (délai, mémoire, nombre et taille de fichiers), drapeau
  `--experimental-permission --allow-fs-read=<chemin du script>`, liste blanche fournie par la
  config, lecture de `ok` et non du code de sortie. Les échantillons de 20, 100 et 300 fichiers
  entrent dans `tests/fixtures/`.
- Dépend de : 0.1.
- [ ] Code — script, build, service.
- [ ] Doc — `docs/modules/application/compilation.md` : pourquoi sans bundler, pourquoi la
      politique d'imports vit dans le script, le drapeau Node et son renommage en Node 22, le filtre
      `lang` comme garantie.
- [ ] Tests — PHPUnit avec le vrai Node si présent (sinon marqué sauté, jamais vert par défaut) :
      sain, cassé, dépassement de taille, délai.
- Commit : `feat(application): compilateur SFC autonome et service de compilation borné`

### 2.3 Le runtime construit au build de l'hôte

- Un script `build:app-runtime` inséré par marqueur dans le `package.json` de l'hôte par
  `socializer:build`, exécuté après `vite build` : copie Vue ESM, vue-i18n ESM, Bootstrap, construit
  `compile.cjs` et `app-runtime.js`, vers `public/vendor/socializer/app-runtime/<version de vue>/`,
  hors du `public/build` que Vite vide ; répertoires anciens conservés. Dépendances à approuver
  (voir les décisions).
- Dépend de : 2.2, et de l'approbation des dépendances.
- [ ] Code — paquet (script, marqueur dans `socializer:build`) **et hôte** (`package.json`,
      `Dockerfile` cible production : le build doit tourner avant `rm -rf node_modules`).
- [ ] Doc — `compilation.md` : le couplage de versions et son véhicule.
- [ ] Tests — contrôle du build : le répertoire versionné existe et porte les mêmes versions que
      `node_modules`.
- Commits : `feat(application): construire le runtime et le compilateur au build de l'hôte`
  (paquet) · `build: script app-runtime et dépendances du runtime d'app` (hôte)

### 2.4 Le pont `@app/runtime`

- Module ESM dans `src/resources/js/app-runtime/` : poignée de main `ready`/`init`, `database`,
  `broadcast` avec `include`/`exclude`, `resize`, événements descendants `users`,
  `connectionEnabled`, `connectionDisabled`, pairs ; filtrage par `event.source`, cible `'*'`
  côté parent. Expose `bootstrap` en global pour les apps migrées. Aucun verbe n'appelle une route
  Laravel ; un verbe futur est une liste blanche côté serveur.
- Dépend de : 0.3.
- [ ] Code — le module, et sa doc d'API générée depuis les docblocks (c'est ce que lira l'agent).
- [ ] Doc — `docs/modules/application/pont.md` : le protocole, verbe par verbe, et les deux
      pièges mesurés (replacer de `JSON.stringify`, `window.location.origin` vaut `null`).
- [ ] Tests — Vitest depuis la racine de l'hôte : chaque verbe, le filtrage par source, un message
      d'une autre fenêtre ignoré.
- Commit : `feat(application): module runtime du pont postMessage`

### 2.5 La coquille et les routes de fichiers

- Route de la coquille : HTML minimal, CSP à host-source explicite, nonce sur l'import map
  construit depuis le manifest, module d'amorçage. Routes de fichiers et de CSS sous
  `/socializer/apps/{app}/{jeton}/{chemin}` : `Access-Control-Allow-Origin: *`, cache immuable,
  **sans session**, type JavaScript pour les `.vue`. Route d'émission du jeton : authentifiée,
  brouillon pour un auteur, version publiée pour un membre.
- Dépend de : 2.1, 2.2, 2.4.
- [ ] Code — routes, contrôleur, réponses.
- [ ] Doc — `docs/modules/application/isolation.md` : pourquoi l'origine opaque et pas un
      sous-domaine, pourquoi CORS ouvert et jeton d'URL, ce qu'un jeton protège (le code) et ce
      qu'il ne protège pas (rien d'autre : les données passent par le parent).
- [ ] Tests — PHPUnit : en-têtes CORS et CSP présents, jeton inconnu ⇒ 404, membre ⇒ jeton publié
      seulement, auteur ⇒ jeton de brouillon.
- Commit : `feat(application): coquille d'exécution, routes de fichiers sous jeton, CORS et CSP`

### 2.6 Le composant parent v2 et la publication minimale

- `ApplicationComponent.vue` : iframe `sandbox` sans `allow-same-origin`, `postMessage(…, '*')`,
  filtrage par `event.source`, rechargement sur nouveau jeton, brouillon ou publié selon le rôle,
  écran d'attente pour un membre sans version publiée. Un bouton **Publier** crée la version 1
  (instantané du brouillon, runtime épinglé). Une app sans `manifest` passe par le **rendu
  hérité** inchangé, derrière les droits du lot 1.
- Dépend de : 2.5.
- [ ] Code — `ApplicationComponent.vue`, service de publication.
- [ ] Doc — `isolation.md` et `donnees.md` ; retirer de `docs/modules/autres-modules.md` ce qui
      est désormais dans le dossier du module, et y laisser le lien.
- [ ] Tests — Vitest : rôle ⇒ jeton demandé, messages d'une autre source ignorés, cible `'*'`.
      `ApplicationComponent.load.test.js` doit rester vert : la course `here` est inchangée.
- Commit : `feat(application): iframe à origine opaque, visibilité par rôle, publication minimale`

### 2.7 L'éditeur manuel

- Dans la modale d'édition : arbre de fichiers (créer, renommer, supprimer), `CodeEditor` de
  formdesigner (composant de la page hôte, pas de l'iframe), bouton Compiler, panneau d'erreurs
  cliquables, rechargement du brouillon sur compilation propre, point de reprise à chaque
  sauvegarde. L'onglet IA actuel, branché sur rien, disparaît ; sa place est tenue par le lot 3.
- Dépend de : 2.6.
- [ ] Code — `ApplicationModale.vue` et ses widgets.
- [ ] Doc — `docs/modules/application/editeur.md` : ce que l'éditeur fait et ne fait pas.
- [ ] Tests — Vitest : une sauvegarde appelle la compilation, une erreur s'affiche sur le bon
      fichier et la bonne ligne.
- Commit : `feat(application): éditeur manuel multi-fichiers avec compilation et erreurs`

### 2.8 La commande de migration

- `socializer:applications:migrate` : septuplet → `App.vue`, `i18n/*.json`, manifest ; table de
  correspondance nom CDN → entrée d'import map ; deux formats de traductions ; **codemod** des deux
  idiomes `window.parent.postMessage(…, window.location.origin)` et
  `event.origin !== window.location.origin` ; compilation ; rapport par app. Une app qui ne
  compile pas reste sur le rendu hérité avec son rapport. `--dry-run` d'abord.
- Dépend de : 2.7.
- [ ] Code — la commande.
- [ ] Doc — `donnees.md`, section migration, avec la liste de ce qui n'est pas converti
      mécaniquement et pourquoi.
- [ ] Tests — PHPUnit sur les quatre `Exemples/*.txt` et sur le document de cette base : les
      quatre compilent après codemod. **Rouges d'abord**, sans le codemod.
- Commit : `feat(application): migrer les apps monofichier vers le système de fichiers virtuel`

### 2.9 Les exemples réécrits sur le pont

- Les quatre `Exemples/*.txt` deviennent quatre apps multi-fichiers dans `src/resources/examples/`,
  écrites sur `@app/runtime`, compilées en test. Elles servent d'exemples à l'éditeur manuel et de
  matière à l'agent.
- Dépend de : 2.4, 2.8.
- [ ] Code — les quatre apps ; suppression des `.txt`.
- [ ] Doc — `pont.md` les référence.
- [ ] Tests — PHPUnit : les quatre compilent.
- Commit : `refactor(application): exemples réécrits en apps multi-fichiers sur le pont`

### 2.10 Vérification à deux navigateurs

- Doctrine du paquet : aucun test de la suite n'exerce le transport réel. Depuis deux postes :
  brouillon visible de l'auteur seul, version publiée visible du membre, `database` aller-retour,
  `broadcast` entre deux iframes, présence mise à jour, redimensionnement.
- Dépend de : 2.9.
- [ ] Vérification manuelle consignée ici, navigateurs et date. **Ne pas cocher sur la seule foi
      du vert.**

**Clôture du lot 2** : un auteur pilote, fichiers fabriqués avec un outil d'IA externe et collés
dans l'éditeur. Consigner ici ce qu'il a réussi, raté, et quels verbes du pont ont manqué. **C'est
la mesure de demande qui décide du lot 3.**

---

## Lot 3 — L'agent et le fil de conversation

### 3.1 Le client modèle

- Interface `ModelClient::chat(messages, tools, options)`, pilote compatible OpenAI (URL de base,
  clé, modèle), pilote Anthropic ; config `agents_ai.coder` ; validation de chaque appel d'outil
  contre son schéma, seconde chance sur appel malformé, repli en actions JSON pour un modèle sans
  appel d'outils. Journal des jetons et de la durée par exécution.
- Dépend de : 2.10 et de la décision sur le modèle.
- [ ] Code — client, deux pilotes, config.
- [ ] Doc — `docs/modules/application/agent.md` : pourquoi deux pilotes, le repli, ce que
      l'agent voit et ne voit jamais (les données du salon).
- [ ] Tests — PHPUnit sur réponses enregistrées, jamais un appel réel.
- Commit : `feat(application): client modèle à deux pilotes, appel d'outils validé`

### 3.2 Les outils sur la copie de travail

- `list_files`, `read_file`, `write_file`, `delete_file`, `rename_file`, `search_files`,
  `compile`, `runtime_docs`, `finish`. Chemins normalisés et confinés, extensions et tailles
  bornées, `compile` rend les erreurs du 2.2 telles quelles.
- Dépend de : 2.2, 3.1.
- [ ] Code — un gestionnaire par outil, un schéma par outil.
- [ ] Doc — `agent.md`, la table des outils.
- [ ] Tests — PHPUnit : chaque outil, un chemin qui sort de l'app, une taille dépassée.
- Commit : `feat(application): outils de l'agent sur la copie de travail`

### 3.3 Le job et le worker dédié

- `RunApplicationAgent` : `$timeout` explicite, `$tries = 1`, `ShouldBeUnique` par fil, file
  `agent`, copie de travail identifiée par exécution, budget de tours, acceptation si compilation
  propre sinon proposition non compilée. Progression par Reverb sur un canal privé des auteurs de
  l'app. **Hôte** : second service worker sur `--queue=agent --timeout=…`, `retry_after` supérieur
  au délai.
- Dépend de : 3.2, et de la décision sur le worker.
- [ ] Code — job, événements, **et compose de l'hôte**.
- [ ] Doc — `agent.md` : pourquoi une seule tentative, pourquoi une file et un worker à part (le
      bot de chat et le fan-out des posts partagent le worker par défaut).
- [ ] Tests — PHPUnit avec modèle factice : boucle qui converge, boucle qui épuise son budget,
      compilation jamais propre ⇒ proposition.
- Commits : `feat(application): job d'agent borné et unique par fil` (paquet) ·
  `ops: worker dédié à la file agent` (hôte)

### 3.4 Le fil de conversation dans la modale

- Collection `application_threads`, routes (poster, lister), panneau à gauche de la modale, arbre
  et éditeur à droite : **les deux modes coexistent**, prompter et éditer à la main, sur les mêmes
  fichiers. Étapes de l'agent affichées au fil de l'eau, proposition non compilée à accepter ou
  rejeter, rechargement du brouillon sur acceptation.
- Dépend de : 3.3.
- [ ] Code — routes, store Pinia, widgets de la modale.
- [ ] Doc — `editeur.md` : les deux modes et leur règle de cohabitation (une exécution d'agent en
      cours verrouille l'édition manuelle du même fil, pas l'inverse).
- [ ] Tests — Vitest : un message lance une exécution, une étape s'affiche, accepter remplace les
      fichiers.
- Commit : `feat(application): fil de conversation avec l'agent dans l'éditeur`

### 3.5 Le prompt système et la doc du pont pour l'agent

- Le prompt porte les règles du runtime (ESM, imports autorisés, pas de `fetch`, pas de stockage
  local, tailles), la doc du pont générée en 2.4, les quatre exemples, l'arbre des fichiers avec
  tailles, les dernières erreurs. Les fichiers se lisent à la demande, jamais tous dans le prompt.
- Dépend de : 3.4.
- [ ] Code — le prompt comme ressource versionnée, pas une chaîne dans une classe.
- [ ] Doc — `agent.md`.
- [ ] Tests — PHPUnit : le prompt se construit sur une app de 300 fichiers sans embarquer leur
      contenu.
- Commit : `feat(application): prompt système de l'agent codeur`

### 3.6 Pilotes

- [ ] Deux ou trois auteurs, quelques semaines. Consigner ici : apps créées, exécutions, coût
      moyen, échecs de compilation non résolus, verbes du pont réclamés. **Décision explicite**
      avant les lots 4 et 5.

---

## Lot 4 — Versions, publication, store

### 4.1 Historique et retour arrière
- Versions listées, retour à une version antérieure (son jeton reste valide), diff entre deux
  versions. Dépend de : 2.6.
- [ ] Code · [ ] Doc (`donnees.md`) · [ ] Tests (PHPUnit).
- Commit : `feat(application): historique des versions et retour arrière`

### 4.2 Rotation du jeton publié sur changement d'appartenance
- Un membre parti garde le code de la version chargée jusqu'à la rotation ; la rotation est un
  nouveau préfixe d'URL, le contenu ne bouge pas. Dépend de : 4.1.
- [ ] Code · [ ] Doc (`isolation.md`) · [ ] Tests (PHPUnit : départ d'un membre ⇒ ancien jeton 404).
- Commit : `feat(application): rotation du jeton publié quand l'appartenance change`

### 4.3 Points de reprise dans l'éditeur
- Liste des cinquante derniers, restauration dans le brouillon. Dépend de : 2.7.
- [ ] Code · [ ] Doc (`editeur.md`) · [ ] Tests (Vitest).
- Commit : `feat(application): points de reprise du brouillon`

### 4.4 Le store, réparé en copie
- Publier une version sur le store (arête `published_in` vers `marketplace`), installer = copier
  les fichiers de cette version dans le brouillon d'un autre salon, jamais un lien. Dépend de : 1.4,
  4.1.
- [ ] Code · [ ] Doc (`docs/modules/application/store.md`) · [ ] Tests (PHPUnit).
- Commit : `feat(application): store des apps, installation par copie`

### 4.5 Fin de vie des runtimes anciens
- Un répertoire de runtime conservé sert une vieille version de Vue, avec ses failles : règle de
  fin de vie (une version publiée qui épingle un runtime retiré est marquée à republier). Dépend
  de : 2.3, 4.1.
- [ ] Code · [ ] Doc (`compilation.md`) · [ ] Tests (PHPUnit).
- Commit : `feat(application): fin de vie des runtimes épinglés`

---

## Lot 5 — Durcissement et clôture

- [ ] 5.1 Limites revues avec les chiffres des pilotes : fichiers, tailles, tours, jetons.
- [ ] 5.2 Relecture de la CSP et des en-têtes par une session relectrice, sondes rejouables dans
      `tests/visual/application-sandbox/`.
- [ ] 5.3 Suppression du rendu hérité quand la dernière app est portée : `template.html`,
      `settings.js`, le chemin same-origin de `ApplicationComponent.vue`, et l'hypothèse de
      confiance qui va avec.
- [ ] 5.4 `docs/modules/application/INDEX.md` sur le modèle de `docs/modules/webrtc2/INDEX.md` ;
      `autres-modules.md` ne garde que le lien ; `resources/boost/guidelines/core.blade.php` reçoit
      au plus deux lignes (le pont est la seule API, l'origine opaque), puis `boost:update` et le
      contrôle `grep 'socializer/core rules ===' CLAUDE.md`.
- [ ] 5.5 Clôture selon `docs/ecrire-la-doc.md` : remonter le durable, supprimer ce fichier,
      retirer sa ligne de `work/README.md`.

---

## Ce qui reste non mesuré, à ce jour

- Les six faits navigateur du 0.2.
- La forme des apps en production (un document ici).
- La ligne rendue pour une erreur de syntaxe dans un `<script setup>` placé après le template.
- La fidélité en appel d'outils du modèle retenu.
- Reverb pendant un job long ; la file `agent` sous `retry_after`.
- La demande réelle : combien d'apps concrètes ont été voulues et pas obtenues.
