/**
 * StreamSimpleUI.awaited.test.js
 *
 * La vignette d'attente — un pair dont un flux est annoncé mais pas encore arrivé — et le
 * **contrat DOM** dont dépend le correctif CSS qui l'a rendue visible.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────────
 *
 * Le dernier 🔴 du module : `.draggable-video` sans `<video>` s'effondrait à 0 px. Un enfant
 * unique en `position:absolute` ne contribue pas à la hauteur de son parent — le cadre valait
 * 0 px, `.video-loading` (`inset:0`) avec lui, et le label débordait dans le
 * `.col.overflow-hidden` qui le clippait. Fermé le 28/08 par une classe d'intention
 * `.video-awaited` et, dans `_socializer.scss`, le gabarit de la règle `video` voisine
 * (`width:100%; aspect-ratio:16/9`).
 *
 * **Il est resté vivant pendant des semaines avec la suite au vert**, et il a été trouvé par
 * une mesure manuelle. La chaîne causale a sept maillons ; six sont des faits sur des fichiers
 * versionnés, un seul est une propriété du moteur de rendu. Ce fichier épingle les six.
 *
 * ⚠️ **Le septième n'est PAS ici, et ne peut pas y être.** `happy-dom` ne calcule aucune mise
 * en page : `getBoundingClientRect()` y rend des zéros. Une assertion `height > 0` serait
 * **rouge sur du code correct**, une assertion `height === 0` serait **verte sur les deux
 * états** — aucune formulation ne discrimine. Ce qui remplace la case est nommé :
 * `tests/visual/check-awaited-thumbnail.mjs`, lancé à la main (sortie D).
 *
 * ⚠️ **Ce fichier monte `Exemples/StreamSimple/StreamSimpleUI.vue`, hors de `Widgets/**`.**
 * Le périmètre annoncé de la tâche 8 était faux sur ce point : le site du correctif est là, et
 * `Exemples/` est bien de la PRODUCTION — l'hôte l'importe
 * (`resources/js/estarter_custom_elements/views/Home.vue:6`). Le nom du dossier ment.
 *
 * ── Ce que la classe `.video-awaited` a de particulier ────────────────────────
 *
 * C'est une **classe d'intention** : aucun binding, aucun style inline, aucune conséquence
 * lisible dans le template. Exactement le profil de ce qu'une passe de nettoyage retire sans y
 * penser — et avant ce fichier, rien à aucun étage n'aurait rougi.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-30 ────────
 *
 *    1. `video-awaited` retirée du `class` de la vignette ................. 4 cas
 *    2. un `<video>` ajouté à l'intérieur de la vignette .................. 1 cas
 *    3. `.video-loading-label` vidé de son slug .......................... 1 cas
 *    4. le `v-for` des pairs en attente retiré ........................... 4 cas
 *    5. `&.video-awaited` retirée de `_socializer.scss` .................. 1 cas
 *    6. `aspect-ratio` retiré de la règle `&.video-awaited` .............. 1 cas
 *
 * Les n° 5 et 6 portent sur le SCSS du PAQUET. ⚠️ C'est la copie de l'hôte qui est réellement
 * compilée (`docs/architecture/conventions.md#scss`) : ces deux contrôles ne disent donc rien
 * de ce qui est servi à l'écran, seulement que le paquet livre encore la règle. La vérification
 * de ce qui est compilé appartient à `tests/visual/check-awaited-thumbnail.mjs`, qui refuse de
 * mesurer si les deux copies ont divergé.
 */
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import StreamSimpleUI from '~socializer/components/WebRTC2/Exemples/StreamSimple/StreamSimpleUI.vue'
import MediaBroadcastPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue'
import { createMediaApiDouble } from './helpers/createMediaApiDouble.js'

const noop = {}

const creerApi = ({ annonces = [], pairs = [], flux = [] } = {}) => ({
    ...createMediaApiDouble(),

    initialize: vi.fn(),
    myName: ref('moi'),
    currentType: ref('stream'),
    currentStream: ref(null),
    screenStream: ref(null),

    // La forme exacte lue par `useAwaitedStreams` — cf. `useAwaitedStreams.test.js`.
    remotePeers: ref(pairs),
    remoteStreams: ref(flux),
    remoteScreens: ref([]),
    announcedStreamPeers: ref(annonces),
})

const monter = (etat) =>
    mount(StreamSimpleUI, {
        props: { api: creerApi(etat) },
        global: {
            stubs: {
                VideoPlayer: { props: ['srcObject'], template: '<video class="video-stub" />' },
                AudioPlayer: { props: ['srcObject'], template: '<audio />' },
                IconWidget: { template: '<i />' },
                Spinner1: { template: '<span class="spinner-stub" />' },
            },
            directives: { resize: noop, draggable: noop },
        },
    })

const vignettes = (w) => w.findAll('.video-awaited')

/**
 * Le SCSS du paquet, lu en source.
 *
 * ⚠️ Deux façons de faire échouent ici, toutes deux **silencieusement** — mesurées :
 *   - `import.meta.glob(…, { query: '?raw' })`, l'idiome habituel du paquet
 *     (`mockFidelity.test.js`), rend une chaîne **VIDE** sur un `.scss` : Vite le traite
 *     comme un asset de style et le `?raw` n'y survit pas. Un `includes()` dessus serait
 *     faux sans jamais lever ;
 *   - `new URL('…', import.meta.url)` est **réécrit statiquement par Vite** en URL d'asset,
 *     donc `fileURLToPath` échoue sur « The URL must be of scheme file ».
 *
 * D'où `dirname(fileURLToPath(...))` + `resolve`, qui échappent aux deux.
 */
const CHEMIN_SCSS = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../sass/socializer/_socializer.scss',
)
const SCSS = readFileSync(CHEMIN_SCSS, 'utf8')

describe('StreamSimpleUI — la vignette d\'attente', () => {

    describe('quand elle apparaît', () => {
        it('aucune vignette quand personne n\'est en attente', () => {
            expect(vignettes(monter())).toHaveLength(0)
        })

        it('un pair qui annonce un flux non encore arrivé a sa vignette', () => {
            const w = monter({ pairs: ['alice'], annonces: ['alice'] })

            expect(vignettes(w)).toHaveLength(1)
        })

        it('un pair présent qui n\'annonce rien n\'en a pas', () => {
            // La règle métier tenue par `useAwaitedStreams` : on n'attend que ce qui est
            // annoncé. Un cas, pas plus — l'heuristique complète est déjà couverte par
            // `useAwaitedStreams.test.js`, et la redoubler ici la ferait diverger.
            const w = monter({ pairs: ['alice', 'bob'], annonces: [] })

            expect(vignettes(w)).toHaveLength(0)
        })
    })

    describe('le contrat DOM dont dépend le correctif CSS', () => {
        it('⭐ la vignette porte exactement `draggable-video video-awaited`', () => {
            // `.video-awaited` est une classe d'INTENTION : rien dans le template ne trahirait
            // sa disparition, et c'est la seule chose qui donne une boîte au cadre. C'est aussi
            // le jeu de classes que reproduit le fixture de `tests/visual/` — si l'un des deux
            // dérive, celui-ci rougit, et c'est le seul des deux qui tourne à chaque suite.
            const w = monter({ pairs: ['alice'], annonces: ['alice'] })

            expect([...vignettes(w)[0].classes()].sort()).toEqual(['draggable-video', 'video-awaited'])
        })

        it('⭐ la vignette ne contient AUCUN élément vidéo — c\'est la cause du 🔴', () => {
            // L'asymétrie exacte qui a produit l'effondrement : ici il n'y a pas de `<video>`,
            // donc aucun enfant en flux, donc rien pour donner une hauteur au parent. Si un
            // `<video>` apparaissait un jour dans ce nœud, ce cas rougirait pour dire « la
            // règle `.video-awaited` est peut-être devenue inutile, relire » — pas pour dire
            // qu'il y a une régression.
            const w = monter({ pairs: ['alice'], annonces: ['alice'] })

            expect(vignettes(w)[0].findAll('video')).toHaveLength(0)
        })

        it('⭐ le player d\'un flux réel, lui, porte `draggable-video` AVEC une vidéo et SANS `video-awaited`', () => {
            // L'autre moitié de l'asymétrie, dans le même fichier : elle n'a de sens qu'en
            // paire. C'est ce contraste qui explique pourquoi la règle CSS est conditionnée à
            // une classe au lieu de s'appliquer à tout `.draggable-video`.
            const player = mount(MediaBroadcastPlayer, {
                props: { streamData: { stream: { id: 's1' }, metadata: { fromName: 'alice' } } },
                global: {
                    stubs: {
                        VideoPlayer: { props: ['srcObject'], template: '<video class="video-stub" />' },
                        AudioPlayer: { props: ['srcObject'], template: '<audio />' },
                        IconWidget: { template: '<i />' },
                        Spinner1: { template: '<span />' },
                    },
                    directives: { resize: noop, draggable: noop },
                },
            })

            const cadre = player.get('.draggable-video')
            expect(cadre.classes()).not.toContain('video-awaited')
            expect(cadre.findAll('video').length).toBeGreaterThan(0)
        })

        it('la vignette dit qui on attend', () => {
            const w = monter({ pairs: ['alice'], annonces: ['alice'] })

            expect(vignettes(w)[0].find('.video-loading').exists()).toBe(true)
            expect(vignettes(w)[0].get('.video-loading-label').text()).toContain('alice')
        })
    })

    describe('l\'autre bout du couplage : la règle SCSS', () => {
        it('⭐ `_socializer.scss` porte encore la règle qui donne sa boîte à la vignette', () => {
            // ⚠️ C'EST UN GREP, pas un test de rendu, et il faut le lire comme tel. Il ferme un
            // seul mode de panne — la suppression pure et simple de la règle, que rien dans le
            // SCSS ne signale comme load-bearing. Il ne voit PAS : si la règle gagne la
            // cascade, si une règle ultérieure l'écrase, si le réordonnancement induit par
            // `@extend` l'a déplacée, ni même si le fichier est compilé. Tout cela est du
            // ressort de `tests/visual/check-awaited-thumbnail.mjs`.
            expect(SCSS, '_socializer.scss introuvable — le glob a-t-il changé de cible ?').toBeTypeOf('string')

            const regle = SCSS.match(/&\.video-awaited\s*\{[^}]*\}/)

            expect(regle, 'la règle `&.video-awaited` a disparu de _socializer.scss').not.toBeNull()
            expect(regle[0]).toContain('aspect-ratio')
        })
    })
})
