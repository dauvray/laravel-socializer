/**
 * CallManagerBtn.test.js
 *
 * La barre de commande d'un appel en cours : couper son micro, couper sa caméra, raccrocher.
 * Elle ne décide de rien — elle rend l'état que `Notifications` lui passe et lui redemande
 * une action, exactement comme `LocalStreamBtn` le fait pour la diffusion.
 *
 * ⚠️ Les deux bascules ne faisaient RIEN avant ce lot : deux `<button>` sans `@click`, avec
 * des icônes littérales figées (`microphone-slash`, `video-slash`). Le défaut n'était pas
 * seulement « les boutons sont morts » — les deux canaux de rendu se contredisaient en
 * permanence : sous la convention du voisin (« l'icône dit l'action à venir »,
 * `LocalStreamBtn.vue:42-51`), `microphone-slash` annonce « couper le son », donc un micro
 * OUVERT ; mais `#call-web-ui button { @extend .btn-secondary; }` est précisément la classe
 * que `LocalStreamBtn` réserve à l'état COUPÉ. Sortie A : les deux boutons sont câblés, et
 * l'icône ET la classe suivent l'état.
 *
 * ⚠️ Les enfants ne sont pas stubés, sauf le spinner. `IconWidget` (`~estarter`) rend
 * `<i class="las la-{icon}">` et n'a aucune dépendance : le stuber reviendrait à asserter le
 * nom d'icône de son propre stub, alors que c'est la valeur rendue qui porte le fait métier.
 *
 * ⚠️ FAIT DE HARNAIS, payé ici : **un stub s'apparie sur le nom du BINDING LOCAL du
 * `<script setup>`, pas sur le `name` du composant.** Le spinner est le même fichier que celui
 * de `MediaBroadcastPlayer.controls.test.js:89` et `RemoteMediaPlayer.test.js:97`, qui le
 * stubent sous la clé `Spinner1` — et ces deux composants l'importent sous ce nom. Ici
 * l'import est `import Spinner from '…/Spinner1.vue'`, donc la clé est `Spinner`, bien que
 * `Spinner1.vue` déclare `name: 'Spinner1'`. Mesuré : avec la clé `Spinner1`, le spinner réel
 * est monté et `.spinner-stub` reste introuvable — un cas qui n'assertait que « 0 bouton »
 * aurait été **vert quand même**, sans jamais exercer la branche d'attente.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 * Référence relue verte avant chaque mutation : 13 cas ici, 7 dans le fichier du joint.
 * La seconde colonne est le fichier du joint (`Notifications.callControls.test.js`).
 *
 *    1. `v-if="props.status !== 'idle'"` retiré (la barre rend toujours) ... 1 · 0
 *    2. le même `v-if` inversé (`=== 'idle'`) ............................. 12 · 6
 *    3. la condition d'attente réduite à `'calling'` seul .................. 1 · —
 *    4. `default: 'idle'` de la prop `status` retiré ....................... 1 · —
 *    5. `<Spinner>` remplacé par du vide ................................... 1 · 1
 *    6. `@click="emit('stop-call')"` retiré ................................ 2 · 1
 *    7. le `@click` de raccrocher déplacé sur la bascule micro ............. 2 · 2
 *    8. les deux `@click` des bascules croisés ............................. 2 · 2
 *    9. l'ICÔNE de la bascule micro figée (`v-if="false"`) ................. 2 · 1
 *   10. la CLASSE de la bascule micro figée ................................ 1 · 1
 *   11. l'ICÔNE de la bascule caméra figée ................................. 2 · 1
 *   12. la CLASSE de la bascule caméra figée ............................... 1 · 1
 *   13. `id="call-web-ui"` renommé ......................................... 1 · 1
 *   14. `class="btn-stop-call"` retirée .................................... 3 · 2
 *   15. `.btn-toggle-on` retirée du SCSS du PAQUET ......................... 1 · —
 *   16. `.btn-toggle-on` retirée du SCSS de l'HÔTE ......................... 1 · —
 *
 * ⚠️ Les n° 9 à 12 sont QUATRE contrôles et non deux : sur chaque bascule, la classe et
 * l'icône sont deux rendus indépendants du même drapeau, aux conditions inversées
 * (`btn-toggle-on` quand la piste est ACTIVE, mais `v-if` sur l'icône quand elle est COUPÉE).
 * Les neutraliser ensemble masquerait qu'un seul des deux est asserté — la leçon du lot A,
 * qui y avait compté 4 contrôles là où l'énoncé en annonçait 2. Les chiffres le confirment :
 * l'icône rougit 2 cas, la classe 1, et ce ne sont pas les mêmes.
 *
 * ⭐ Le n° 4 était annoncé comme le 0 le plus probable du fichier, et c'est pour ça que le
 * premier cas monte DEUX fois : `{ status: 'idle' }` et `{}`. Il rougit 1 — donc le second
 * montage est bien ce qui exerce le défaut de la prop, et il n'était pas décoratif.
 *
 * ⭐ Le n° 1 rougit **0 cas du fichier du joint**, et c'est une information et non un trou :
 * là-bas, le `v-if` du PARENT couvre déjà le cas, donc retirer celui de l'enfant ne change
 * rien au rendu. Les deux gardes ne se doublonnent pas pour autant — voir l'en-tête de
 * `CallManagerBtn.vue` — mais leur différence (le chargement paresseux du chunk) n'est
 * observable dans aucun des deux runners.
 *
 * Les n° 15 et 16 portent sur les DEUX copies du SCSS, mesurées séparément — chacune rougit le
 * même cas, qui les asserte toutes les deux. ⚠️ C'est la copie de l'hôte qui est réellement
 * compilée (`docs/architecture/conventions.md#scss`) : ces contrôles ne disent donc rien de ce
 * qui est servi à l'écran, seulement que les deux copies livrent encore la règle et qu'elles
 * n'ont pas divergé.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import CallManagerBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/CallManagerBtn.vue'

/**
 * ⚠️ `props` sans défaut, volontairement : `monter()` doit pouvoir monter le composant SANS
 * aucune prop, c'est le seul chemin qui exerce le `default: 'idle'`.
 */
const monter = (props = {}) =>
    mount(CallManagerBtn, {
        props,
        global: { stubs: { Spinner: { template: '<span class="spinner-stub" />' } } },
    })

/** Le bouton qui porte cette icône — l'icône est la seule identité stable des bascules. */
const boutonAvecIcone = (wrapper, icone) =>
    wrapper.findAll('button').find((b) => b.find(`.la-${icone}`).exists())

const basculeMicro = (wrapper) =>
    boutonAvecIcone(wrapper, 'microphone') ?? boutonAvecIcone(wrapper, 'microphone-slash')

const basculeVideo = (wrapper) =>
    boutonAvecIcone(wrapper, 'video') ?? boutonAvecIcone(wrapper, 'video-slash')

/** Le bouton d'arrêt, ciblé par sa CLASSE : c'est aussi son point d'accroche CSS. */
const raccrocher = (wrapper) => wrapper.find('.btn-stop-call')

const attente = (wrapper) => wrapper.find('.spinner-stub')

/**
 * Les deux copies du SCSS, lues en source.
 *
 * Le chemin passe par `dirname(fileURLToPath(import.meta.url))` et non par un import : Vite
 * traite un `.scss` comme un module de style et rendrait une chaîne vide — précédent et
 * explication complète dans `StreamSimpleUI.awaited.test.js:97-113`.
 */
const ICI = dirname(fileURLToPath(import.meta.url))
const SCSS_PAQUET = readFileSync(
    resolve(ICI, '../../../../../sass/socializer/_socializer.scss'),
    'utf8',
)
const SCSS_HOTE = readFileSync(
    resolve(ICI, '../../../../../../../../../../resources/sass/socializer/_socializer.scss'),
    'utf8',
)

describe('CallManagerBtn — la barre de commande d\'appel', () => {

    describe('ce que l\'utilisateur voit selon l\'état de l\'appel', () => {
        it('⭐ hors appel la barre n\'existe pas — et c\'est le défaut de la prop qui rend ce cas atteignable', () => {
            // Deux montages, et le second est le point : la prop `status` n'est pas
            // `required`, donc un montage sans état est possible. Le défaut `'idle'` est ce
            // qui l'empêche alors de rendre trois boutons de commande, dont « raccrocher »,
            // hors de tout appel. La garde du parent (`Notifications.vue:14`) ne le couvre
            // pas : elle garde autre chose, le chargement paresseux du chunk asynchrone.
            for (const wrapper of [monter({ status: 'idle' }), monter()]) {
                expect(wrapper.find('#call-web-ui').exists()).toBe(false)
                expect(wrapper.findAll('button')).toHaveLength(0)
                expect(attente(wrapper).exists()).toBe(false)
            }
        })

        it('⭐ en attente — à l\'émission COMME à la réception — il n\'y a rien à cliquer', () => {
            // Deux états et non un : une condition réduite à `'calling'` resterait verte la
            // moitié du temps. Et le fait dur, qui n'est pas un contrat mais un constat :
            // on ne peut PAS annuler un appel qui sonne. C'est exactement ce qui a rendu
            // invisible la régression du spinner bloqué (`Notifications.vue:118-124`).
            for (const status of ['calling', 'receiving']) {
                const wrapper = monter({ status })

                expect(attente(wrapper).exists()).toBe(true)
                expect(wrapper.findAll('button')).toHaveLength(0)
            }
        })

        it('⭐ appel établi ET fermeture en cours donnent la même barre de trois boutons', () => {
            // Le `v-else` n'est pas « connected » : c'est « tout ce qui n'est ni idle, ni
            // calling, ni receiving ». Les cinq états de la FSM sont dans
            // `utils/useCallStateMachine.js:12-17`, donc `closing` tombe ici et n'a PAS de
            // spinner — ce qu'aucune lecture du template ne rend évident.
            for (const status of ['connected', 'closing']) {
                const wrapper = monter({ status })

                expect(attente(wrapper).exists()).toBe(false)
                expect(wrapper.findAll('button')).toHaveLength(3)
                expect(basculeMicro(wrapper)).toBeDefined()
                expect(basculeVideo(wrapper)).toBeDefined()
                expect(raccrocher(wrapper).exists()).toBe(true)
            }
        })
    })

    describe('les trois actions', () => {
        it('le bouton rouge raccroche', async () => {
            const wrapper = monter({ status: 'connected' })

            await raccrocher(wrapper).trigger('click')

            expect(wrapper.emitted('stop-call')).toHaveLength(1)
            expect(wrapper.emitted('toggle-audio')).toBeUndefined()
            expect(wrapper.emitted('toggle-video')).toBeUndefined()
        })

        it('la bascule micro demande la bascule au parent sans décider de l\'état', async () => {
            const wrapper = monter({ status: 'connected', isMuted: false })
            const avant = basculeMicro(wrapper).html()

            await basculeMicro(wrapper).trigger('click')

            expect(wrapper.emitted('toggle-audio')).toHaveLength(1)
            expect(wrapper.emitted('toggle-video')).toBeUndefined()
            // Les props n'ont pas bougé : la barre n'a donc rien à afficher de nouveau.
            // C'est le parent qui détient l'état — le même contrat que `LocalStreamBtn`.
            expect(basculeMicro(wrapper).html()).toBe(avant)
        })

        it('la bascule caméra demande la bascule au parent sans décider de l\'état', async () => {
            const wrapper = monter({ status: 'connected', isVideoEnabled: true })
            const avant = basculeVideo(wrapper).html()

            await basculeVideo(wrapper).trigger('click')

            expect(wrapper.emitted('toggle-video')).toHaveLength(1)
            expect(wrapper.emitted('toggle-audio')).toBeUndefined()
            expect(basculeVideo(wrapper).html()).toBe(avant)
        })
    })

    describe('ce que l\'utilisateur voit de ses pistes', () => {
        it('⭐ le micro coupé se voit, sur la classe ET sur l\'icône', () => {
            const ouvert = monter({ status: 'connected', isMuted: false })
            expect(basculeMicro(ouvert).find('.la-microphone-slash').exists()).toBe(true)
            expect(basculeMicro(ouvert).classes()).toContain('btn-toggle-on')

            const coupe = monter({ status: 'connected', isMuted: true })
            expect(basculeMicro(coupe).find('.la-microphone').exists()).toBe(true)
            expect(basculeMicro(coupe).classes()).not.toContain('btn-toggle-on')
        })

        it('⭐ la caméra coupée se voit, et l\'icône dit l\'action et non l\'état', () => {
            // Le point contre-intuitif, identique à celui de `LocalStreamBtn` : caméra
            // ACTIVE ⇒ icône `video-slash`, parce que l'icône annonce ce que le clic va
            // faire (« couper la caméra »). Lue comme un état, elle paraît inversée. La
            // classe, elle, suit bien l'état — et c'est pourquoi les deux se mesurent
            // séparément.
            const active = monter({ status: 'connected', isVideoEnabled: true })
            expect(basculeVideo(active).find('.la-video-slash').exists()).toBe(true)
            expect(basculeVideo(active).classes()).toContain('btn-toggle-on')

            const coupee = monter({ status: 'connected', isVideoEnabled: false })
            expect(basculeVideo(coupee).find('.la-video').exists()).toBe(true)
            expect(basculeVideo(coupee).classes()).not.toContain('btn-toggle-on')
        })

        it('⭐ les deux bascules sont indépendantes', () => {
            // Deux drapeaux, deux boutons : avec un seul drapeau à la fois, un rendu qui
            // lirait le mauvais drapeau donnerait le même vert la moitié du temps.
            const microCoupeCamActive = monter({
                status: 'connected', isMuted: true, isVideoEnabled: true,
            })
            expect(basculeMicro(microCoupeCamActive).find('.la-microphone').exists()).toBe(true)
            expect(basculeVideo(microCoupeCamActive).find('.la-video-slash').exists()).toBe(true)

            const microOuvertCamCoupee = monter({
                status: 'connected', isMuted: false, isVideoEnabled: false,
            })
            expect(basculeMicro(microOuvertCamCoupee).find('.la-microphone-slash').exists()).toBe(true)
            expect(basculeVideo(microOuvertCamCoupee).find('.la-video').exists()).toBe(true)
        })

        it('les défauts des deux drapeaux sont ceux du contexte réel', () => {
            // `createPeerContext.js:152-153` : micro ouvert, caméra active. Une barre montée
            // sans ces props doit donc montrer les deux pistes ACTIVES, pas coupées — c'est
            // précisément ce que les icônes figées d'avant ce lot ne pouvaient pas faire.
            const wrapper = monter({ status: 'connected' })

            expect(basculeMicro(wrapper).find('.la-microphone-slash').exists()).toBe(true)
            expect(basculeVideo(wrapper).find('.la-video-slash').exists()).toBe(true)
            expect(basculeMicro(wrapper).classes()).toContain('btn-toggle-on')
            expect(basculeVideo(wrapper).classes()).toContain('btn-toggle-on')
        })
    })

    describe('le vocabulaire d\'événements', () => {
        it('⭐ la barre n\'en émet que trois, et chaque bouton n\'en émet qu\'un', async () => {
            // L'énumération exacte remplace l'assertion négative : elle rougit aussi bien si
            // un quatrième événement apparaît que si l'un des trois disparaît. Avant ce lot
            // il n'y en avait qu'UN, les deux bascules étant muettes.
            // ⚠️ Piège de harnais : `emitted()` capte AUSSI les événements DOM natifs qui
            // remontent jusqu'à la racine du composant — ici `click`, à chaque `trigger`.
            // Les écarter n'affaiblit rien : ce qui est asserté est le vocabulaire que le
            // parent peut écouter en `@…`, pas le bouillonnement du DOM.
            const emis = new Set()

            for (const status of ['calling', 'receiving', 'connected', 'closing']) {
                const wrapper = monter({ status })
                for (const el of wrapper.findAll('button')) {
                    await el.trigger('click')
                }
                Object.keys(wrapper.emitted())
                    .filter((e) => e !== 'click')
                    .forEach((e) => emis.add(e))
            }

            expect([...emis].sort()).toEqual(['stop-call', 'toggle-audio', 'toggle-video'])
        })
    })

    describe('l\'identité sur laquelle la feuille de style s\'accroche', () => {
        it('⭐ la barre porte son id et le bouton rouge sa classe — aucun bouton ne porte de classe Bootstrap', () => {
            const wrapper = monter({ status: 'connected' })

            expect(wrapper.find('#call-web-ui').exists()).toBe(true)
            expect(raccrocher(wrapper).exists()).toBe(true)

            // C'est la forme exacte du 🔴 de la vignette : AUCUN bouton du template ne porte
            // `.btn`, `.btn-sm`, `.btn-secondary` ni `.btn-danger`. Toutes viennent
            // d'`@extend` sous `#call-web-ui`. Renommer l'id casse la mise en page ET
            // déshabille les trois boutons, sans qu'aucune autre assertion ne bouge.
            for (const bouton of wrapper.findAll('button')) {
                expect(bouton.classes()).not.toContain('btn')
                expect(bouton.classes()).not.toContain('btn-sm')
                expect(bouton.classes()).not.toContain('btn-secondary')
                expect(bouton.classes()).not.toContain('btn-danger')
            }
        })

        it('⭐ `btn-toggle-on` est une classe du paquet, et les deux copies du SCSS la portent', () => {
            // Pourquoi une classe MAISON et non `btn-primary` : question de spécificité, pas
            // de goût. `#call-web-ui button` vaut (1,0,1) et écrase un `class="btn-primary"`
            // posé dans le template, à (0,1,0) — l'état actif serait invisible. Le motif de
            // contournement était déjà dans le fichier : `.btn-stop-call`, à (1,1,0).
            //
            // ⚠️ Ce cas ne dit RIEN de ce qui est servi à l'écran : `happy-dom` ne calcule
            // aucune mise en page, et c'est la copie de l'HÔTE qui est compilée. Il dit deux
            // choses vérifiables : les deux copies livrent encore la règle, et elles n'ont
            // pas divergé.
            for (const [nom, source] of [['paquet', SCSS_PAQUET], ['hôte', SCSS_HOTE]]) {
                const barre = source.match(/#call-web-ui\s*\{[\s\S]*?\n\}/)
                expect(barre, `bloc #call-web-ui introuvable dans la copie ${nom}`).not.toBeNull()
                expect(
                    barre[0],
                    `.btn-toggle-on absente du bloc #call-web-ui, copie ${nom}`,
                ).toMatch(/\.btn-toggle-on\s*\{/)
            }
        })
    })
})
