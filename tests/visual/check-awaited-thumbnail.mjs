#!/usr/bin/env node
/**
 * check-awaited-thumbnail.mjs — vérifie que la vignette d'attente OCCUPE une boîte, et
 * qu'elle n'est pas clippée par son ancêtre `overflow-hidden`.
 *
 * ── Pourquoi ce fichier n'est pas un test ─────────────────────────────────────
 *
 * `happy-dom` ne calcule aucune mise en page : `getBoundingClientRect()` y rend des zéros.
 * Une assertion `height > 0` y serait rouge sur du code correct, une assertion `height === 0`
 * y serait verte sur les deux états — aucune formulation ne discrimine. Ce n'est pas un test
 * difficile à écrire dans la suite, c'est un test **impossible** dans ce runner, et jsdom n'y
 * changerait rien.
 *
 * C'est donc une **sortie D assumée** : une vérification manuelle, mais à verdict automatique.
 * Elle est invisible aux deux runners du paquet — `phpunit.xml` ne déclare que
 * `tests/Feature`, et l'`include` de `vitest.config.js` ne prend que
 * `src/resources/js/**\/__tests__/**\/*.test.js`.
 *
 * ── Quand la lancer ───────────────────────────────────────────────────────────
 *
 *   1. retouche du bloc `.draggable-video` de `_socializer.scss` ;
 *   2. retouche de la chaîne d'ancêtres (`.col.overflow-hidden` de `StreamSimpleUI.vue:31`,
 *      `.col-md-8` de `Exemples/Home.vue:69`) ;
 *   3. montée de version de Bootstrap.
 *
 * ── Comment ───────────────────────────────────────────────────────────────────
 *
 *   RUNTIME="$(bash ~/.claude/skills/browser-visual-check/scripts/bootstrap.sh)"
 *   cd <racine de l'hôte> && npm run build          # sinon public/build est absent/périmé
 *   NODE_PATH="$RUNTIME/node_modules" node vendor/dauvray/laravel-socializer/tests/visual/check-awaited-thumbnail.mjs
 *
 * ⚠️ Playwright vit HORS du dépôt (`~/.claude-tools/browser`), ce qui laisse le
 * `package.json` de l'hôte intact — mais rend ce script **non portable** : sur une machine
 * sans ce runtime, il s'arrête avec le message qui le dit, et c'est tout.
 *
 * ── Ce qu'il ne garantit PAS ──────────────────────────────────────────────────
 *
 *   - que `awaitedPeers` rende un nœud (c'est `StreamSimpleUI.awaited.test.js`) ;
 *   - que le fixture ressemble encore à la production (copie à la main, cf. son en-tête) ;
 *   - quoi que ce soit si personne ne le lance. C'est un outil, pas un filet.
 */
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const ICI = dirname(fileURLToPath(import.meta.url))
const PAQUET = resolve(ICI, '../..')
const HOTE = resolve(PAQUET, '../../..')
const FIXTURE = join(ICI, 'awaited-thumbnail.fixture.html')
const SORTIE = join(ICI, 'out')

const LARGEUR = 1440
const HAUTEUR = 1000

let echecs = 0

const fatal = (message) => {
    console.error(`\n✗ ARRÊT — ${message}\n`)
    process.exit(2)
}

const verifier = (condition, message, detail = '') => {
    if (condition) {
        console.log(`  ✓ ${message}`)
    } else {
        console.error(`  ✗ ${message}${detail ? `\n      ${detail}` : ''}`)
        echecs++
    }
}

// ── 1. Le runtime navigateur, hors dépôt ─────────────────────────────────────
//     ⚠️ `NODE_PATH` ne s'applique QU'À CommonJS : un `import('playwright')` en ESM
//     l'ignore et échoue, même runtime correctement installé. D'où `createRequire`, qui
//     emprunte le résolveur CJS — c'est aussi ce que fait `shot.js` de la skill. Le repli
//     explicite couvre le cas où le résolveur n'honore pas la variable.
let chromium
try {
    const require = createRequire(import.meta.url)
    let playwright
    try {
        playwright = require('playwright')
    } catch {
        const racines = (process.env.NODE_PATH ?? '').split(':').filter(Boolean)
        const trouvee = racines.find((r) => existsSync(join(r, 'playwright')))
        if (!trouvee) { throw new Error('introuvable') }
        playwright = require(join(trouvee, 'playwright'))
    }
    ;({ chromium } = playwright)
} catch {
    fatal(
        'playwright introuvable. Ce script s\'appuie sur un runtime HORS dépôt :\n' +
        '        RUNTIME="$(bash ~/.claude/skills/browser-visual-check/scripts/bootstrap.sh)"\n' +
        '        NODE_PATH="$RUNTIME/node_modules" node ' + fileURLToPath(import.meta.url),
    )
}

// ── 2. La CSS compilée, résolue par le MANIFESTE — jamais un hash en dur ─────
const manifeste = join(HOTE, 'public/build/manifest.json')
if (!existsSync(manifeste)) {
    fatal(`manifeste introuvable : ${manifeste}\n        Lancer \`npm run build\` depuis ${HOTE}.`)
}
const entree = JSON.parse(readFileSync(manifeste, 'utf8'))['resources/sass/app.scss']
if (!entree?.file) {
    fatal('la clé `resources/sass/app.scss` est absente du manifeste — la chaîne de build a changé.')
}
const CSS = join(HOTE, 'public/build', entree.file)
if (!existsSync(CSS)) {
    fatal(`CSS compilée annoncée par le manifeste mais absente : ${CSS}`)
}

// ── 3. Fraîcheur — jumeau du piège de l'about:blank ──────────────────────────
//     Une CSS périmée mesure l'état d'AVANT, tout aussi silencieusement qu'une page nue.
const scssPaquet = join(PAQUET, 'src/resources/sass/socializer/_socializer.scss')
const scssHote = join(HOTE, 'resources/sass/socializer/_socializer.scss')
const ageCss = statSync(CSS).mtimeMs
for (const source of [scssPaquet, scssHote]) {
    if (existsSync(source) && statSync(source).mtimeMs > ageCss) {
        fatal(`CSS périmée : ${source} est plus récent que ${entree.file}.\n        Relancer \`npm run build\` depuis ${HOTE}.`)
    }
}

// ── 4. C'est la copie de l'HÔTE qui est compilée ─────────────────────────────
//     Si les deux ont divergé, on ne sait plus ce qu'on mesure.
if (existsSync(scssPaquet) && existsSync(scssHote)) {
    if (readFileSync(scssPaquet, 'utf8') !== readFileSync(scssHote, 'utf8')) {
        fatal(
            'les deux copies de `_socializer.scss` ont divergé.\n' +
            '        C\'est celle de l\'hôte qui est compilée ; mesurer maintenant ne dirait rien du paquet.\n' +
            `        paquet : ${scssPaquet}\n        hôte   : ${scssHote}`,
        )
    }
}

// ── 5. La page ───────────────────────────────────────────────────────────────
const navigateur = await chromium.launch()
const page = await navigateur.newPage({ viewport: { width: LARGEUR, height: HAUTEUR } })

// `goto(file://…)` et JAMAIS `setContent()`, qui part d'`about:blank` et n'y charge aucun
// `<link href="file://">`. `addStyleTag({ path })` est lu par Node, donc indépendant du
// schéma d'URL de la page.
await page.goto(pathToFileURL(FIXTURE).href, { waitUntil: 'load' })
await page.addStyleTag({ path: CSS })

// ── 6. LES CANARIS, AVANT toute mesure ───────────────────────────────────────
//     Ils prouvent que la CASCADE est là, pas seulement que la page a chargé quelque chose.
//     Le 28/08, « h=51 dans les deux cas » s'est lu « le correctif ne sert à rien » sur une
//     page sans aucune CSS. Le canari existe pour que le message nomme la VRAIE cause.
const cascade = await page.evaluate(() => ({
    bootstrap: getComputedStyle(document.querySelector('[data-role=canary-bootstrap]')).display,
    socializer: getComputedStyle(document.querySelector('[data-role=subject]')).cursor,
}))
if (cascade.bootstrap !== 'none') {
    await navigateur.close()
    fatal(`Bootstrap absent de la cascade (.d-none → « ${cascade.bootstrap} », attendu « none »).\n        MESURE SANS VALEUR — ne pas lire les chiffres qui suivraient.`)
}
if (cascade.socializer !== 'grab') {
    await navigateur.close()
    fatal(`_socializer.scss absent de la cascade (.draggable-video → cursor « ${cascade.socializer} », attendu « grab »).\n        MESURE SANS VALEUR.`)
}
console.log('\nCascade vérifiée : Bootstrap et _socializer.scss sont bien appliqués.\n')

// ── 7. Géométrie, aux DEUX largeurs de conteneur possibles ───────────────────
//
//     ⚠️ Il n'existe PAS de hauteur de référence à retrouver, et c'est un résultat de cette
//     passe. La largeur du conteneur de page est un RÉGLAGE — `layout_class_container` par
//     route, à défaut `config('estarter.bootstrap_container_type')` : `container-fluid` chez
//     cet hôte, `container` par défaut dans le paquet. Toute cote absolue serait donc vraie
//     d'une configuration et fausse de l'autre.
//
//     (Le todo cite ~391 px mesurés le 28/08 à la main. Ce chiffre n'est pas reproductible
//     ici — la chaîne d'ancêtres du harnais d'alors n'a pas été conservée — et il ne doit pas
//     servir de seuil : viser un nombre reviendrait à ajuster le fixture à une mesure
//     perdue plutôt qu'au produit.)
//
//     Ce qui EST stable, et ce que ce script vérifie, est indépendant de la largeur :
//     le contrôle s'effondre, le sujet non, le ratio vaut 16/9, rien n'est clippé.
//
//     `isVisible()` n'apparaît nulle part et ne le doit pas : il rend `true` sur un élément
//     entièrement clippé par un ancêtre (boîte non vide, visibility:visible, opacity:1).
const mesurer = async (classeConteneur) => {
    await page.evaluate((cls) => {
        document.querySelector('[data-role=page-container]').className = cls
    }, classeConteneur)

    return page.evaluate(() => {
        const boite = (role) => {
            const r = document.querySelector(`[data-role=${role}]`).getBoundingClientRect()
            return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height }
        }
        return {
            subject: boite('subject'),
            subjectLabel: boite('subject-label'),
            subjectClipper: boite('subject-clipper'),
            control: boite('control'),
        }
    })
}

const dedans = (b, cadre) =>
    b.top >= cadre.top - 1 && b.bottom <= cadre.bottom + 1 &&
    b.left >= cadre.left - 1 && b.right <= cadre.right + 1

const tableau = {}

for (const classeConteneur of ['container', 'container-fluid']) {
    const m = await mesurer(classeConteneur)

    tableau[`${classeConteneur} — sujet`] = {
        largeur: Math.round(m.subject.width), hauteur: Math.round(m.subject.height),
    }
    tableau[`${classeConteneur} — contrôle`] = {
        largeur: Math.round(m.control.width), hauteur: Math.round(m.control.height),
    }

    console.log(`\nVérifications — conteneur « ${classeConteneur} » :`)

    verifier(m.subject.height > 100,
        'le cadre de la vignette a une boîte réelle',
        `hauteur mesurée : ${Math.round(m.subject.height)} px`)

    verifier(m.control.height < 5,
        'le CONTRÔLE (sans .video-awaited) s\'effondre bien, comme avant le 28/08',
        `hauteur du contrôle : ${Math.round(m.control.height)} px — s'il ne s'effondre plus, ce harnais a ` +
        'PERDU son pouvoir discriminant : relire, `.video-awaited` est peut-être devenue redondante. ' +
        'Rouge qui veut dire « relire », pas « régression ».')

    verifier(m.subject.height > m.control.height * 10,
        'sujet et contrôle sont nettement discernables')

    const ratio = m.subject.width / m.subject.height
    verifier(Math.abs(ratio - 16 / 9) < 0.05,
        'le cadre tient le ratio 16/9 de la règle',
        `ratio mesuré : ${ratio.toFixed(3)} (attendu ${(16 / 9).toFixed(3)})`)

    // LE point qui compte, et celui qu'`isVisible()` ne verrait pas.
    verifier(dedans(m.subjectLabel, m.subjectClipper),
        'le label tient dans les bornes de son ancêtre .col.overflow-hidden',
        `label ${JSON.stringify(m.subjectLabel)}\n      clippeur ${JSON.stringify(m.subjectClipper)}`)

    verifier(m.subject.right <= m.subjectClipper.right + 1,
        'la vignette ne déborde pas de sa colonne')
}

console.log(`\nMesures (viewport ${LARGEUR}×${HAUTEUR}) — indicatives, PAS un seuil :`)
console.table(tableau)

// ── 8. Capture TOUJOURS — la relecture humaine est ce qui a trouvé le 🔴 ─────
mkdirSync(SORTIE, { recursive: true })
const png = join(SORTIE, 'awaited-thumbnail.png')
await page.screenshot({ path: png, fullPage: true })
await navigateur.close()

console.log(`\nCapture écrite : ${png}`)
console.log('→ La relire. C'.concat("'est une relecture de capture qui a trouvé le 🔴, pas une assertion."))

if (echecs > 0) {
    console.error(`\n✗ ${echecs} vérification(s) en échec.\n`)
    process.exit(1)
}
console.log('\n✓ Tout est conforme.\n')
