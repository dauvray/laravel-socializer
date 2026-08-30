# `tests/visual/` — ce que les deux suites ne peuvent pas voir

**Ce dossier n'est ramassé par aucun runner.** `phpunit.xml` ne déclare que `tests/Feature`,
et l'`include` de `vitest.config.js` (côté hôte) ne prend que
`src/resources/js/**/__tests__/**/*.test.js`. C'est **volontaire** : ce qui est ici se lance à
la main.

## Pourquoi ça existe

La suite JS tourne sous `happy-dom`, qui **ne calcule aucune mise en page** :
`getBoundingClientRect()` y rend des zéros. Une assertion de géométrie y serait soit rouge sur
du code correct, soit verte sur les deux états — aucune formulation ne discrimine. Ce n'est
pas un test difficile à écrire, c'est un test **impossible dans ce runner**, et jsdom n'y
changerait rien.

Or c'est exactement la classe de défaut du dernier 🔴 du module : `.draggable-video` sans
`<video>` s'effondrait à 0 px, et **il est resté vivant des semaines avec la suite au vert**.

D'où le partage, qui vaut pour tout ce qu'on ajouterait ici :

> **La suite n'asserte que sur des fichiers versionnés. `tests/visual/` asserte sur les
> artefacts de build — et une absence ou une péremption y est un échec dur, jamais un
> silence.**

## Lancer

```bash
# 1. une fois par machine — installe Playwright HORS du dépôt (~/.claude-tools/browser),
#    ce qui laisse le package.json de l'hôte intact
RUNTIME="$(bash ~/.claude/skills/browser-visual-check/scripts/bootstrap.sh)"

# 2. depuis la racine de l'HÔTE — sans build, il n'y a pas de CSS compilée à mesurer
cd /var/www/estarter-test && npm run build

# 3. la vérification
NODE_PATH="$RUNTIME/node_modules" node \
  vendor/dauvray/laravel-socializer/tests/visual/check-awaited-thumbnail.mjs
```

⚠️ `NODE_PATH` n'est honoré **que par le résolveur CommonJS** : le script passe donc par
`createRequire`. Un `import('playwright')` nu échouerait, runtime correctement installé.

## `check-awaited-thumbnail.mjs`

Vérifie que la vignette d'attente occupe une boîte et n'est pas clippée par son ancêtre
`overflow-hidden`.

**Quand le relancer** : retouche du bloc `.draggable-video` de `_socializer.scss` ; retouche de
la chaîne d'ancêtres (`.col.overflow-hidden` de `StreamSimpleUI.vue`, `.col-md-8` de
`Exemples/Home.vue`) ; montée de version de Bootstrap.

**Ce qu'il fait, et pourquoi dans cet ordre** :

1. résout la CSS compilée par `public/build/manifest.json` — **jamais un hash en dur** ;
2. **refuse de mesurer** si cette CSS est plus vieille que l'un des deux `_socializer.scss` :
   une CSS périmée mesure l'état d'avant, aussi silencieusement qu'une page nue ;
3. **refuse de mesurer** si les deux copies du SCSS ont divergé — c'est celle de l'hôte qui est
   compilée, donc on ne saurait plus ce qu'on mesure ;
4. `goto('file://…')`, **jamais `setContent()`** qui part d'`about:blank`, puis
   `addStyleTag({ path })`, lu par Node donc indépendant du schéma d'URL ;
5. **deux canaris de cascade AVANT toute mesure** — `.d-none` ⇒ `display:none` (Bootstrap) et
   `.draggable-video` ⇒ `cursor:grab` (`_socializer.scss`). Ils existent pour que le message
   dise « CSS absente » et non « cadre effondré » : le 28/08, « h=51 dans les deux cas » s'est
   lu « le correctif ne sert à rien » sur une page **sans aucune CSS** ;
6. mesure le **sujet** et le **contrôle** (la même vignette sans `.video-awaited`, c'est-à-dire
   l'état d'avant le correctif), présents **dans la même page** — le run de contrôle ne peut
   donc plus être oublié ;
7. rejoue le tout pour **les deux classes de conteneur** possibles ;
8. écrit une capture, **toujours**.

**`isVisible()` n'apparaît nulle part, et ne doit jamais y apparaître** : il rend `true` sur un
élément entièrement clippé par un ancêtre (boîte non vide, `visibility:visible`, `opacity:1`).
Ce qui tranche est la **géométrie comparée à celle de l'ancêtre**, ou la capture relue.

### Il n'y a pas de hauteur de référence — c'est un résultat, pas un oubli

`work/webrtc2-todo.md` cite ~391 px mesurés à la main le 28/08. **Ce chiffre ne doit pas servir
de seuil.** La largeur du conteneur de page est un **réglage** — `layout_class_container` par
route, à défaut `config('estarter.bootstrap_container_type')`, qui vaut `container-fluid` chez
cet hôte et `container` par défaut dans le paquet. Toute cote absolue serait vraie d'une
configuration et fausse de l'autre. Le script rejoue donc la mesure aux deux largeurs et
n'asserte que ce qui ne dépend pas d'elles : le contrôle s'effondre, le sujet non, le ratio
vaut 16/9, rien n'est clippé. Les chiffres affichés sont indicatifs.

### Ce qu'il ne garantit pas

- **Que le fixture ressemble encore à la production.** C'est une copie à la main de la chaîne
  d'ancêtres. Le garde-fou n'est pas ici mais dans la suite : `StreamSimpleUI.awaited.test.js`
  asserte que le jeu de classes rendu par le composant réel est exactement
  `draggable-video video-awaited`. Ce fichier-là tourne à chaque `npm run test:run`.
- **Que `awaitedPeers` rende un nœud** — même fichier de suite.
- **Quoi que ce soit sur une machine sans le runtime hors dépôt.** Le script s'arrête alors
  avec le message qui le dit.
- **Quoi que ce soit si personne ne le lance.** C'est un outil à verdict automatique, pas un
  filet. C'est la borne assumée de la sortie D — arbitrage complet dans
  `work/webrtc2-tests-plan.md`, tâche 8.
