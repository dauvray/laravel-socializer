/**
 * MediaBroadcastProvider.test.js — le câblage, et le joint provide/inject
 *
 * Soixante-douze lignes qui ne portent aucune logique métier : elles **construisent** l'api de
 * diffusion, la **distribuent** (provide, slot, expose) et branchent son cycle de vie sur celui
 * du composant. C'est le seul composant de la chaîne WebRTC2, et donc le seul endroit où un
 * `inject` est possible — d'où le canal Reverb, qui n'a pas d'autre point d'entrée.
 *
 * ⭐ **Le joint que ce fichier est seul à voir.** `WEBRTC_API_KEY` a exactement **un `provide`**
 * (ici, l. 44) et **un `inject`** (`LocalMediaPlayer.vue:23`) dans tout le dépôt. Deux
 * extrémités, aucun autre témoin : les permuter, ou provide autre chose que l'api, ne rougit
 * aucun test d'étage — `LocalMediaPlayer.test.js` fournit la clé lui-même, et ce fichier-ci
 * doublerait l'api. C'est le profil exact du joint `conn.peer` du lot C, et la raison du dernier
 * cas de ce fichier.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * **`useMediaBroadcast` est DOUBLÉ.** Ce qu'il y a à tester ici est du câblage : quels arguments
 * partent à la construction, lequel des trois verbes est appelé quand. La moitié « l'api a bien
 * cette forme » est déjà tenue ailleurs, et sur l'orchestrateur RÉEL, par
 * `useMediaBroadcast.surface.test.js` — qui nomme même `MediaBroadcastProvider.vue:50/:56/:63`
 * comme les sites d'appel des trois verbes. La monter réelle ici serait ce doublon, payé en
 * `withSetup` + `mockEventBus` + mock PeerJS.
 *
 * Ce que le double ne peut PAS couvrir, et qui est donc resté hors de ce fichier : un renommage
 * dans le `return` de `useMediaBroadcast`. Là encore, `surface.test.js` le tient.
 *
 * ⚠️ Le double est déréférencé à l'APPEL, pas à l'import : la fabrique de `vi.mock` est hoistée
 * au-dessus des déclarations du fichier, un `() => apiDouble` direct lèverait en TDZ. Même
 * idiome que `useMediaBroadcast.watchUsers.test.js` et `Notifications.test.js`.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 *
 * Référence relue verte avant chaque mutation : 79 fichiers, 1417 cas.
 *
 *    1. la clé de `provide` permutée (Symbol neuf) ......... 1 cas  (0 AILLEURS)
 *    2. `{ immediate: true }` retiré du watch .............. 3 cas
 *    3. `props.room ?? 'app'` ramené à `props.room` ........ 1 cas
 *    4. garde `if(props.callbacks)` retirée d'`onMounted` .. 1 cas
 *    5. `api.cleanup()` retiré d'`onBeforeUnmount` ......... 1 cas
 *    6. `{ reverb }` retiré des deps de construction ....... 3 cas
 *    7. `:api="api"` du slot renommé en `:webrtc` .......... 1 cas
 *    8. `defineExpose({ api })` retiré .................... 1 cas  (0 avant réécriture du cas)
 *    9. `deep: true` ajouté au watch ...................... 1 cas  (0 avant correction du harnais)
 *
 * ⭐ **Le chiffre qui vaut ce fichier est le n° 1 : 1 cas ICI, et 0 dans les deux autres
 * fichiers du lot.** `LocalMediaPlayer.test.js` fournit la clé lui-même et reste vert ;
 * `StreamSimpleUI.local.test.js` aussi. Le joint provide/inject peut donc mourir entièrement
 * pendant que les deux étages restent verts — c'est le mode de panne que ce fichier ferme, et
 * la raison pour laquelle il ne pouvait pas être un `describe` ailleurs.
 *
 * ⚠️ **Deux contrôles ont mesuré 0 au premier passage, et les DEUX fois la faute était dans le
 * test** — quatrième lot consécutif où ce motif revient :
 *
 *  • n° 8 : le cas était écrit `monter().vm.api`. **`wrapper.vm` de VTU atteint les bindings
 *    d'un `script setup` même sans `defineExpose`** : le cas ne pouvait pas échouer. Réécrit
 *    avec une ref de template — un `script setup` est fermé par défaut, seule la ref voit
 *    exactement ce que la production voit (`Home.vue:12`).
 *  • n° 9 : le cas poussait dans un tableau **nu**. Pousser dans un tableau non réactif n'est vu
 *    par AUCUN watcher, profond ou pas : le cas était vert des deux côtés. La composition passe
 *    donc par un `ref`, comme `useReverbChannel` l'expose réellement.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { h, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import MediaBroadcastProvider from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue'
import LocalMediaPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/LocalMediaPlayer.vue'
import { REVERB_CHANNEL } from '~socializer/components/System/system.config.js'
import { createMediaApiDouble } from './helpers/createMediaApiDouble.js'

const apiDouble = {
    ...createMediaApiDouble(),
    initialize: vi.fn(),
    cleanup: vi.fn(),
    watchUsers: vi.fn(),
}

const useMediaBroadcast = vi.fn(() => apiDouble)

vi.mock('~socializer/components/WebRTC2/Composables/useMediaBroadcast.js', () => ({
    useMediaBroadcast: (...args) => useMediaBroadcast(...args),
}))

/** Les arguments de construction du dernier montage : (type, room, options, deps). */
const construitAvec = () => useMediaBroadcast.mock.calls.at(-1)

const monter = (props = {}, options = {}) =>
    mount(MediaBroadcastProvider, {
        props: { users: [], ...props },
        ...options,
    })

beforeEach(() => {
    // Le double est unique et vit au niveau module (la fabrique de `vi.mock` doit pouvoir le
    // rendre à chaque appel). Son ÉTAT doit donc être remis à la main : `clearAllMocks` ne
    // touche que les compteurs d'appels, pas les valeurs que les cas précédents ont écrites.
    vi.clearAllMocks()
    apiDouble._etats.isMuted = false
    apiDouble._etats.isVideoEnabled = true
    apiDouble.currentStream.value = null
    apiDouble.screenStream.value = null
})

describe('MediaBroadcastProvider — la construction de l\'api', () => {

    it('transmet le mode, la room, les options et les deps d\'infrastructure', () => {
        const options = { topology: 'star', hubSlug: 'admin', videoContainer: '#v' }
        monter({ mode: 'stream', room: 'room-1', options })

        expect(construitAvec()).toEqual(['stream', 'room-1', options, { reverb: null }])
    })

    it('⭐ sans room, diffuse dans `app` — et non dans `null`', () => {
        // `room` est déclarée `default: null`, donc l'absence de prop ne déclenche PAS le
        // défaut de `useMediaBroadcast` : c'est ce `?? 'app'` qui le fait. `AudioComponent`
        // et `Home` passent toujours une room ; le chemin nu est celui d'un hôte tiers.
        monter()

        expect(construitAvec()[1]).toBe('app')
    })

    it('le mode par défaut est `data`', () => {
        monter()

        expect(construitAvec()[0]).toBe('data')
    })

    describe('le canal Reverb, optionnel par contrat', () => {
        it('⭐ le canal fourni par la page atteint l\'api', () => {
            // Le SEUL `inject` de toute la chaîne WebRTC2, et il est ici parce qu'ici seulement
            // on est dans un composant. `Home.vue` fait `provide(REVERB_CHANNEL, reverb)` pour
            // toute la page ; sans ce chemin, l'annonce de diffusion par whisper est muette.
            const canal = { whisper: vi.fn() }
            monter({}, { global: { provide: { [REVERB_CHANNEL]: canal } } })

            expect(construitAvec()[3]).toEqual({ reverb: canal })
        })

        it('sans canal, tout se construit quand même — la clé est présente et vaut null', () => {
            // `null` et non `undefined`, et la clé présente et non absente : `usePeerOrchestrator`
            // déstructure `deps.reverb`, et un hôte qui ne veut pas de l'annonce est un cas
            // normal, pas une erreur de câblage.
            monter()

            expect(construitAvec()[3]).toEqual({ reverb: null })
        })
    })

    it('⭐ un objet `options` partiel arrive AMPUTÉ — le défaut est remplacé en bloc, pas fusionné', () => {
        // Statu quo épinglé (sortie C), pas un défaut : c'est la sémantique Vue des défauts
        // d'objet. Elle est piégeuse ici parce que la clé qui disparaît décide de la topologie —
        // un consommateur qui écrit `:options="{ hubSlug: 'admin' }"` en croyant garder `star`
        // obtient un `topology` absent, donc `mesh` côté fabrique, sans un mot.
        //
        // Le cas garde la porte dans les DEUX sens : si quelqu'un ajoute une fusion un jour, il
        // le fera en connaissance de cause, et il verra ce cas rougir.
        monter({ options: { hubSlug: 'admin' } })

        expect(construitAvec()[2]).toEqual({ hubSlug: 'admin' })
        expect(construitAvec()[2].topology).toBeUndefined()
    })
})

describe('MediaBroadcastProvider — le cycle de vie', () => {

    it('⭐ le premier tour de présence part AU MONTAGE, liste initiale comprise', () => {
        // `{ immediate: true }`, et c'est un contrat load-bearing : `useMediaBroadcast.watchUsers`
        // a vu son garde `length === 0` retiré en s'appuyant explicitement sur ce tour à vide
        // (`useMediaBroadcast.js:141-148`). Il traverse la chaîne, ne purge rien et n'apprend
        // rien — c'est `getRoomUsersDiff` qui décide de ne pas déclarer la présence connue. Le
        // retirer casserait la synchronisation initiale d'une page montée avec ses membres.
        monter({ users: [{ slug: 'alice' }] })

        expect(apiDouble.watchUsers).toHaveBeenCalledTimes(1)
        expect(apiDouble.watchUsers).toHaveBeenCalledWith([{ slug: 'alice' }])
    })

    it('⭐ chaque composition suivante part aussi, y compris la liste VIDE', async () => {
        // La liste vide est le seul tour capable de purger le dernier partant — donc de le
        // sortir de l'allowlist que lisent les deux gardes d'autorisation. Deux tours dans ce
        // cas : sans le second, « il transmet » et « il transmet une fois » sont le même vert.
        const w = monter({ users: [{ slug: 'alice' }] })

        await w.setProps({ users: [{ slug: 'alice' }, { slug: 'bob' }] })
        await w.setProps({ users: [] })

        expect(apiDouble.watchUsers.mock.calls.map(([liste]) => liste)).toEqual([
            [{ slug: 'alice' }],
            [{ slug: 'alice' }, { slug: 'bob' }],
            [],
        ])
    })

    it('⭐ le watch n\'est PAS profond : une composition mutée en place n\'est pas vue', async () => {
        // Statu quo épinglé, et le contrat qu'il impose aux fournisseurs de présence : le
        // `watch(() => props.users)` suit la RÉFÉRENCE, donc seul un remplacement de tableau
        // déclenche une synchronisation.
        //
        // `useReverbChannel` le respecte partout (`users.value = [...users.value, user]`,
        // l. 148, et deux autres réaffectations) — mais rien ne l'y oblige. Mesuré : y écrire
        // un `push` à la place rougit **0 cas sur 1416**, alors que la présence de TOUS les
        // providers cesserait de se synchroniser. Panne fail-closed (les arrivants ne sont
        // jamais admis) et parfaitement muette. Ce cas est la moitié qu'on peut tenir ici ;
        // l'autre moitié est un item de `work/`.
        //
        // ⚠️ **La composition doit passer par un `ref`, et c'est une mesure.** Écrit avec un
        // tableau nu, ce cas rendait **0 à sa propre contre-épreuve** (`deep: true` ajouté) :
        // pousser dans un tableau non réactif n'est vu par AUCUN watcher, profond ou pas, donc
        // le cas était vert des deux côtés et ne prouvait rien. `useReverbChannel` expose
        // `users` comme un `ref([])` (l. 70), et `ref` réactive en profondeur : c'est le proxy
        // qu'un `deep: true` observerait. Sans cette fidélité, le cas se lit « le watch est
        // superficiel » alors qu'il ne dit que « mon tableau de test est inerte ».
        const presence = ref([{ slug: 'alice' }])
        const w = monter({ users: presence.value })

        presence.value.push({ slug: 'bob' })
        await nextTick()

        expect(apiDouble.watchUsers).toHaveBeenCalledTimes(1)

        // Et la contre-épreuve dans le même cas : réaffecter, lui, passe.
        await w.setProps({ users: [...presence.value] })

        expect(apiDouble.watchUsers).toHaveBeenCalledTimes(2)
    })

    it('⭐ avec des callbacks, il initialise l\'api lui-même', () => {
        const callbacks = { onDataReceived: vi.fn() }
        monter({ callbacks })

        expect(apiDouble.initialize).toHaveBeenCalledWith(callbacks)
    })

    it('⭐ SANS callbacks, il n\'initialise rien — c\'est l\'enfant qui le fera', () => {
        // Le cas de `StreamSimpleUI`, qui appelle `api.initialize` dans son propre `onMounted`
        // avec ses trois callbacks de flux. Initialiser ici en plus poserait deux jeux de
        // callbacks sur le même contexte, le second écrasant le premier.
        monter()

        expect(apiDouble.initialize).not.toHaveBeenCalled()
    })

    it('libère l\'api au démontage', () => {
        // Connexions fermées, flux arrêtés, minuteurs annulés : sans ça une navigation SPA
        // laisserait un `Peer` vivant et son peerId périmé chez les pairs distants.
        monter().unmount()

        expect(apiDouble.cleanup).toHaveBeenCalledTimes(1)
    })
})

describe('MediaBroadcastProvider — la distribution de l\'api', () => {

    it('⭐ le slot reçoit l\'api sous la clé `api`', () => {
        // Le NOM compte : `Home.vue` écrit `v-slot="webrtc"` puis `v-bind="webrtc"` vers
        // `Debug` et `ChatSimpleUI`, qui déclarent une prop `api`. Renommer le binding ici
        // rendrait `api: undefined` chez trois consommateurs, sans qu'aucun ne lève au montage.
        let recu
        monter({}, { slots: { default: (params) => { recu = params; return h('span') } } })

        expect(recu.api).toBe(apiDouble)
    })

    it('⭐ expose l\'api au parent, par ref de template', () => {
        // `Home.vue:12` porte `ref="broadcastDataRef"` et appelle `broadcastDataRef.value.api`
        // — `initialize` dans son `onMounted`, `sendData` dans un callback de connexion. C'est
        // le chemin des consommateurs qui n'ont pas d'UI dans le slot.
        //
        // ⚠️ **Ce cas EXIGE la ref de template, et c'est une mesure.** Écrit en
        // `monter().vm.api`, il rendait **0 cas** à la contre-épreuve : `wrapper.vm` de VTU
        // atteint les bindings d'un `script setup` MÊME SANS `defineExpose`. Il ne prouvait
        // donc rien. Une ref de template ne voit que ce qui est exposé — un `script setup` est
        // fermé par défaut —, ce qui est exactement le contrat que la production utilise.
        const Parent = {
            components: { MediaBroadcastProvider },
            template: '<MediaBroadcastProvider ref="provider" :users="[]" />',
        }

        expect(mount(Parent).vm.$refs.provider.api).toBe(apiDouble)
    })

    it('⭐⭐ un LocalMediaPlayer descendant reçoit l\'api par provide/inject, vivante', async () => {
        // LE JOINT. `WEBRTC_API_KEY` n'a qu'un provide (ici) et qu'un inject
        // (`LocalMediaPlayer.vue:23`) : personne d'autre ne peut voir les deux bouts.
        //
        // Deux affirmations dans un seul cas, et les deux sont nécessaires : le player MONTE
        // (sans l'api il lève), et il RÉAGIT (donc c'est bien l'objet réactif qui a traversé,
        // et pas un instantané). Un provide qui passerait une copie déballée monterait très
        // bien et n'afficherait plus jamais rien.
        const webcam = { id: 'flux-webcam' }
        apiDouble.currentStream.value = webcam

        const w = monter({}, {
            slots: {
                default: () => h(LocalMediaPlayer, {
                    streamData: { stream: webcam, metadata: { fromName: 'Moi', isMe: true } },
                }),
            },
            global: {
                stubs: {
                    VideoPlayer: { props: ['srcObject', 'muted'], template: '<video class="video-stub" />' },
                    AudioPlayer: { props: ['srcObject', 'muted'], template: '<audio class="audio-stub" />' },
                    Spinner1: { template: '<span class="spinner-stub" />' },
                },
            },
        })

        expect(w.find('.video-stub').exists()).toBe(true)

        apiDouble.toggleVideoVisibility()
        await nextTick()

        expect(w.find('.audio-stub').exists()).toBe(true)
    })
})
