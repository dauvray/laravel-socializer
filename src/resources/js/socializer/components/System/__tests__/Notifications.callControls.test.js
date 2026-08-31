/**
 * Notifications.callControls.test.js — le joint entre `Notifications` et `CallManagerBtn`
 *
 * `CallManagerBtn` est purement présentationnel : il rend l'état qu'on lui passe et redemande
 * une action. `Notifications` est l'adaptateur qui détient l'API de `useMediaBroadcast`. Le
 * même partage que `LocalStreamBtn` (présentation) / `GroupLocalStreamBtn` (adaptateur) — et,
 * comme là-bas, **ce qui n'est testable qu'ici est la COUTURE** : les quatre attributs du
 * template. Un nom d'attribut faux ne rougit aucun cas du fichier de la barre, qui monte le
 * composant directement.
 *
 * ⚠️ C'est un fichier séparé de `Notifications.test.js` pour la même raison que
 * `GroupLocalStreamBtn.permission.test.js` l'est de son jumeau : le harnais n'est pas le même.
 * Celui-ci doit RÉSOUDRE le composant asynchrone, l'autre n'en a jamais besoin.
 *
 * ⚠️ FAIT DE HARNAIS, et c'est le piège neuf du lot F : **`CallManagerBtn` est un
 * `defineAsyncComponent`** (`Notifications.vue:42`), et aucun test du paquet n'en résolvait un
 * jusqu'ici. Sans résolution, le composant est un **nœud commentaire** — le conteneur rend
 * littéralement `<!---->` — donc `findAll('button')` rend `[]`, `find('.btn-stop-call')` rend
 * `false`, et tout cas écrit en négatif est **vert par vacuité** : la famille de faute qui a
 * coûté quatre lots. D'où le garde-fou du premier cas, qui asserte la PRÉSENCE avant tout le
 * reste.
 *
 * ⚠️ Et l'outil n'est PAS `flushPromises()`. Mesuré, à la sonde : **quatre tours de
 * `flushPromises()` laissent le placeholder en place**, parce que la fabrique est un `import()`
 * dynamique — pas une microtâche en attente, un chargement de module. Ce qui le résout est
 * **`await vi.dynamicImportSettled()`**, et il le résout **à lui seul** : un `flushPromises()`
 * ajouté derrière ne change plus rien. Un fichier qui monterait un composant asynchrone en
 * comptant les tours de `flushPromises` chercherait un chiffre qui n'existe pas.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 * Référence relue verte avant chaque mutation : 7 cas ici, 13 dans `CallManagerBtn.test.js`.
 * La seconde colonne est ce fichier-là — c'est elle qui porte la démonstration.
 *
 *    1. `@toggle-audio` renommé dans le template de `Notifications.vue` .... 2 · 0
 *    2. `@toggle-video` renommé dans le template de `Notifications.vue` .... 2 · 0
 *    3. `:isMuted` retiré du template ..................................... 1 · 0
 *    4. `:isVideoEnabled` retiré du template .............................. 1 · 0
 *    5. `:status` retiré du template ...................................... 6 · 0
 *    6. les deux écouteurs de bascule croisés ............................. 3 · 0
 *    7. `@stop-call="onStopCall"` retiré .................................. 1 · 0
 *    8. `v-if="callStatus !== 'idle'"` du parent retiré ................... 0 · —  ABSORBÉ
 *    9. `vi.dynamicImportSettled()` remplacé par `flushPromises()` ........ 6 · —
 *
 * ⭐ **LE CHIFFRE QUI VAUT CE FICHIER : les sept contrôles de couture rougissent ici, et
 * ZÉRO cas de `CallManagerBtn.test.js`.** La barre et son adaptateur peuvent cesser
 * entièrement de se parler — attribut renommé, prop coupée, écouteurs croisés — sans qu'un
 * seul cas de l'étage présentationnel bouge. C'est la mesure qui interdit de se contenter de
 * deux fichiers, et elle est symétrique de celle du lot C sur le joint `conn.peer`.
 *
 * ⭐ **n° 8 : 0 par ABSORPTION, et c'est une information.** Retirer le `v-if` du parent ne
 * rougit rien parce que l'enfant porte sa propre garde sur `status !== 'idle'` : le rendu est
 * identique. Ce que le `v-if` du parent garde en plus — empêcher le chunk asynchrone d'être
 * chargé sur toutes les pages — n'est observable dans **aucun** des deux runners. Sortie D
 * assumée : la ligne reste, sa raison est écrite dans `CallManagerBtn.vue`, et le 0 est noté
 * ici pour ne pas être re-mesuré.
 *
 * Le n° 9 n'est pas un contrôle de production : il mesure le garde-fou lui-même. Six cas sur
 * sept tombent — la preuve que sans `dynamicImportSettled` ce fichier ne testerait rien, et
 * que `flushPromises` n'est pas un substitut.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createCallPeersDouble } from './helpers/createCallPeersDouble.js'

// ─── Doubles ─────────────────────────────────────────────────────────────────

// Le double et ses cinq fidélités vivent dans le helper, partagé avec `Notifications.test.js`.
const peers = createCallPeersDouble()
const peersDouble = peers.api

vi.mock('~socializer/components/WebRTC2/Composables/useMediaBroadcast.js', () => ({
    useMediaBroadcast: () => peersDouble,
}))

vi.mock('~socializer/components/System/composables/useReverbChannel.js', () => ({
    useReverbChannel: () => ({ whisper: vi.fn(() => true), leave: vi.fn() }),
}))

// Les stores sont mockés en vrais stores Pinia : `storeToRefs` n'accepte rien d'autre.
vi.mock('~estarter/stores/me.js', async () => {
    const { defineStore } = await import('pinia')
    return {
        useMeStore: defineStore('me', {
            state: () => ({ me: { id: 1, slug: 'alice', channel: 'App.Models.User.1' } }),
            getters: { getMe: (state) => state.me },
            actions: { addUnreadNotifications() {} },
        }),
    }
})

vi.mock('~socializer/stores/peers2.js', async () => {
    const { defineStore } = await import('pinia')
    return { usePeer2Store: defineStore('peers2', { actions: { dispatchSignal() {} } }) }
})

vi.mock('~socializer/stores/conversations.js', async () => {
    const { defineStore } = await import('pinia')
    return {
        useConversationsStore: defineStore('conversations', { actions: { addConversation() {} } }),
    }
})

import Notifications from '~socializer/components/System/Notifications.vue'

// ─── Harnais ─────────────────────────────────────────────────────────────────

const eventBus = { $emit: vi.fn(), $on: vi.fn(), $off: vi.fn() }

/**
 * Monte `Notifications` et **attend la résolution du composant asynchrone**.
 * Sans `dynamicImportSettled`, `CallManagerBtn` reste un nœud commentaire — voir l'en-tête.
 * `flushPromises` n'y suffit pas, et n'y ajoute rien : mesuré.
 */
const monter = async () => {
    const wrapper = mount(Notifications, {
        global: {
            provide: { eventBus },
            stubs: { Spinner: { template: '<span class="spinner-stub" />' } },
        },
    })
    await vi.dynamicImportSettled()
    return wrapper
}

const barre = (wrapper) => wrapper.find('#call-web-ui')

const boutonAvecIcone = (wrapper, icone) =>
    wrapper.findAll('button').find((b) => b.find(`.la-${icone}`).exists())

const basculeMicro = (wrapper) =>
    boutonAvecIcone(wrapper, 'microphone') ?? boutonAvecIcone(wrapper, 'microphone-slash')

const basculeVideo = (wrapper) =>
    boutonAvecIcone(wrapper, 'video') ?? boutonAvecIcone(wrapper, 'video-slash')

const raccrocher = (wrapper) => wrapper.find('.btn-stop-call')

let wrapper

beforeEach(() => {
    vi.clearAllMocks()
    window.AWN = { info: vi.fn(), alert: vi.fn() }
    peers.reinitialiser()
    peers.statutAppel.value = 'connected'
})

afterEach(() => {
    wrapper?.unmount()
    delete window.AWN
})

describe('Notifications — la barre de commande d\'appel', () => {

    it('⭐ la barre est réellement montée — le garde-fou de tout ce fichier', async () => {
        wrapper = await monter()

        // Sans ce cas, un `flushPromises` oublié rendrait tous les autres verts par vacuité :
        // un composant asynchrone non résolu est un nœud commentaire, et toute recherche dans
        // le DOM y répond « absent » sans erreur.
        expect(barre(wrapper).exists()).toBe(true)
        expect(wrapper.findAll('button')).toHaveLength(3)
        expect(raccrocher(wrapper).exists()).toBe(true)
    })

    it('hors appel, la barre n\'est pas montée du tout', async () => {
        peers.statutAppel.value = 'idle'

        wrapper = await monter()

        // Le `v-if` du parent ne double pas celui de l'enfant : c'est lui qui empêche le chunk
        // asynchrone d'être chargé sur toutes les pages. L'enfant, lui, se défend d'un montage
        // sans état — deux gardes, deux métiers.
        expect(barre(wrapper).exists()).toBe(false)
    })

    it('⭐ la barre suit l\'état de l\'appel, elle ne le lit pas une seule fois', async () => {
        peers.statutAppel.value = 'calling'
        wrapper = await monter()

        expect(wrapper.find('.spinner-stub').exists()).toBe(true)
        expect(wrapper.findAll('button')).toHaveLength(0)

        // ⚠️ C'est ce cas qui exige la fidélité n° 1 du double : `callStatus` doit être lu à
        // travers un `ref`. Avec un `vi.fn(() => 'calling')` figé, le `computed` de
        // `Notifications.vue:71` n'a aucune dépendance, ce cas reste bloqué sur le spinner et
        // le double supprime silencieusement la réactivité que la production a.
        peers.statutAppel.value = 'connected'
        await nextTick()

        expect(wrapper.find('.spinner-stub').exists()).toBe(false)
        expect(wrapper.findAll('button')).toHaveLength(3)
    })

    it('⭐ « couper le micro » atteint l\'API, et ne touche pas à la caméra', async () => {
        wrapper = await monter()

        await basculeMicro(wrapper).trigger('click')

        expect(peersDouble.toggleAudioMute).toHaveBeenCalledTimes(1)
        expect(peersDouble.toggleVideoVisibility).not.toHaveBeenCalled()
        // L'assertion négative sur le reste de l'API : seule elle rend visible un câblage
        // croisé vers un verbe voisin.
        expect(peersDouble.stopCallWithPeers).not.toHaveBeenCalled()
    })

    it('⭐ « couper la caméra » atteint l\'API, et ne touche pas au micro', async () => {
        wrapper = await monter()

        await basculeVideo(wrapper).trigger('click')

        expect(peersDouble.toggleVideoVisibility).toHaveBeenCalledTimes(1)
        expect(peersDouble.toggleAudioMute).not.toHaveBeenCalled()
        expect(peersDouble.stopCallWithPeers).not.toHaveBeenCalled()
    })

    it('⭐ la boucle complète : le clic bascule l\'état, et le rendu le dit', async () => {
        wrapper = await monter()

        expect(basculeMicro(wrapper).find('.la-microphone-slash').exists()).toBe(true)
        expect(basculeMicro(wrapper).classes()).toContain('btn-toggle-on')

        await basculeMicro(wrapper).trigger('click')
        await nextTick()

        // Le fait qui compte, et qu'aucun étage ne peut voir seul : l'aller (l'attribut
        // `@toggle-audio`) ET le retour (l'attribut `:isMuted`) sont branchés sur le même
        // fait. Casser l'un des deux laisse l'autre vert.
        expect(basculeMicro(wrapper).find('.la-microphone').exists()).toBe(true)
        expect(basculeMicro(wrapper).classes()).not.toContain('btn-toggle-on')

        await basculeVideo(wrapper).trigger('click')
        await nextTick()

        expect(basculeVideo(wrapper).find('.la-video').exists()).toBe(true)
        expect(basculeVideo(wrapper).classes()).not.toContain('btn-toggle-on')
        // La bascule caméra n'a pas rouvert le micro : deux drapeaux, deux boutons.
        expect(basculeMicro(wrapper).find('.la-microphone').exists()).toBe(true)
    })

    it('raccrocher annonce la fin de l\'appel puis l\'arrête', async () => {
        peersDouble.currentCallUsers.value = [{ userSlug: 'bob', type: 'visio' }]
        wrapper = await monter()

        await raccrocher(wrapper).trigger('click')
        await flushPromises()

        // `close-call` AVANT `stopCallWithPeers`, et sur une copie : c'est ce qui réarme les
        // boutons d'appel des murs, dont `stopCallWithPeers` vide la liste juste après.
        expect(eventBus.$emit).toHaveBeenCalledWith('close-call', [
            { userSlug: 'bob', type: 'visio' },
        ])
        expect(peersDouble.stopCallWithPeers).toHaveBeenCalledWith([
            { userSlug: 'bob', type: 'visio' },
        ])
    })
})
