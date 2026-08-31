/**
 * MediaBroadcastPlayer.controls.test.js — les contrôles de la vignette
 *
 * L'étage au-dessus de `useMediaControls.test.js` : le joint entre les trois boutons et
 * l'élément média réel. Ce que ce fichier garde, et que l'autre ne peut pas garder, c'est
 * la **chaîne de noms** — `ref="player"` → clé exposée `nativeVideo` → élément. Mesuré :
 * renommer `nativeVideo` dans `~estarter/VideoPlayer.vue` rougit **3 cas ici et 0 au
 * fichier composable**, dont le `ref({ nativeVideo })` fait main est aveugle par
 * construction. C'est la raison de la coupe entre les deux fichiers, et la raison de ne
 * PAS stuber le lecteur : un stub qui expose `nativeVideo` valide sa propre orthographe.
 * Le dépôt en a déjà le cadavre — `AudioPlayer` expose `nativeAudio`.
 *
 * Choix d'infra
 * ─────────────
 * • **Vrais `VideoPlayer` / `AudioPlayer`** (`docs/modules/webrtc2/tests.md`, « monter les
 *   enfants réels »). Seul `Spinner1` est stubé : il n'est pas dans le joint. `IconWidget`
 *   reste réel, comme partout ailleurs.
 * • **`realStream()`** de `helpers/fakeMedia.js` : le `validator` de la prop `srcObject`
 *   exige une vraie `MediaStream`. Une instance distincte par vignette — deux vignettes
 *   qui partageraient l'objet rendraient indétectable toute confusion de flux.
 * • **`attachTo: document.body`** : `equip()` refuse un élément détaché, parce qu'un vrai
 *   `requestFullscreen` rejette dans ce cas.
 * • **Le cadre `.draggable-video` est équipé lui aussi.** Sans ça, « le plein écran porte
 *   sur la vidéo » serait vert parce que le cadre n'a pas la méthode — c'est l'absence qui
 *   déciderait, pas le code.
 * • **Aucune `directives: { resize, draggable }`** : elles seraient INERTES, le composant
 *   résolvant ses directives en bindings de setup. Delta assumé : le pool monte avec
 *   `resizable`/`draggable` à `true`, nous prenons les défauts à `false`, donc les vraies
 *   directives sortent en early-return.
 * • **Les boutons sont désignés par leur libellé**, comme l'utilisateur : ils n'ont ni id
 *   ni `data-*`, et le libellé du premier EST une assertion (« Mute » / « Unmute »).
 * • ⚠️ **Jamais `attributes('muted')`** : happy-dom réfléchit `muted` en attribut, un vrai
 *   navigateur non (seul `defaultMuted` réfléchit). On asserte la **propriété** `.muted`,
 *   sinon on épingle un artefact du runner.
 *
 * Non-duplication déclarée
 * ────────────────────────
 * « Aucun bouton sur la branche audio » n'est PAS réasserté ici : il vit à
 * `MediaBroadcastPlayer.spinner.test.js` et `RemoteMediaPlayer.test.js`. Mesuré :
 * neutraliser le `v-if="props.videoActive"` du bloc de contrôles rougit **0 cas ici** et
 * 2 cas là-bas. Ce fichier ajoute l'autre moitié — **pourquoi** ils sont masqués.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ──────────────────
 *
 *  `ref="player"` retiré du <VideoPlayer> ..................... 8 cas
 *  `nativeVideo` renommé chez ~estarter (édition temporaire) .. 8 cas  (0 au composable)
 *  `nativeAudio` renommé en `nativeVideo` chez ~estarter ...... 1 cas  (0 au composable)
 *  `:muted="isLocallyMuted"` du <VideoPlayer> figé à false .... 2 cas
 *  `:muted="isLocallyMuted"` de l'<AudioPlayer> remis à
 *      `metadata?.isMe || false` (l'état d'avant) ............. 1 cas
 *  `controls.releasePresentation()` retiré du watch ........... 2 cas
 *  `nativeMuted.value = false` retiré du watch ................ 1 cas
 *  `=== el` de togglePip ramené à l'état d'avant .............. 1 cas
 *  garde `v-if="!metadata?.isMe"` du bouton Mute retirée ...... 1 cas
 *  `:class` du bouton Mute figé ............................... 1 cas
 *  libellé du bouton Mute figé à 'Mute' ....................... 1 cas
 *  `:controls="controls"` retiré du slot #controls ............ 2 cas
 *
 * Deux zéros mesurés sur référence relue verte (28 cas), trois passes :
 *  • **`v-if="props.videoActive"` du bloc de contrôles ⇒ 0 cas ici, et 2 ailleurs** —
 *    `spinner.test.js` (« n'affiche pas les contrôles vidéo sur la branche audio ») et
 *    `RemoteMediaPlayer.test.js` (« couper sa caméra bascule TOUT le player »). C'est la
 *    mesure qui prouve qu'il ne faut pas dupliquer ce fait ici.
 *  • **garde `if (m !== null)` de `onToggleNativeMute` ⇒ 0 cas, et CONSERVÉE** : elle
 *    n'affirme rien de faux, elle protège le lecteur unique de la sentinelle — `false` est
 *    une valeur légitime (« démuté ») et un `if (m)` casserait le démutage. La sortie B est
 *    pour une ligne qui MENTE, pas pour toute ligne immesurable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MediaBroadcastPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue'
import { installPresentationApis } from './helpers/fakeFullscreen.js'
import { realStream, fakeTrack } from './helpers/fakeMedia.js'

let scene
let trace
const wrappers = []

const flux = (fromName = 'Alice', extra = {}) => ({
    stream: realStream([fakeTrack('video'), fakeTrack('audio')]),
    metadata: { fromName, roomId: 'room-1', ...extra },
})

const monter = (props = {}, slots = {}) => {
    const wrapper = mount(MediaBroadcastPlayer, {
        props: { streamData: flux(), ...props },
        slots,
        attachTo: document.body,
        global: { stubs: { Spinner1: { template: '<span class="spinner-stub" />' } } },
    })
    wrappers.push(wrapper)

    scene.equip(wrapper.element) // le cadre : équipé pour qu'il ne gagne pas par forfait
    const video = wrapper.find('video')
    if (video.exists()) scene.equip(video.element)

    return wrapper
}

const bouton = (wrapper, libelle) =>
    wrapper.findAll('.video-controls button').find((b) => b.text() === libelle)

const libelles = (wrapper) => wrapper.findAll('.video-controls button').map((b) => b.text())

beforeEach(() => {
    scene = installPresentationApis()
    trace = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    wrappers.splice(0).forEach((w) => w.unmount())
    scene.restore()
    trace.mockRestore()
    document.body.innerHTML = ''
})

describe('MediaBroadcastPlayer — ce que la vignette offre', () => {

    it('la branche vidéo offre exactement Mute, Fullscreen et PIP', () => {
        expect(libelles(monter())).toEqual(['Mute', 'Fullscreen', 'PIP'])
    })

    it('⭐ couper le son de la vignette coupe le vrai <video>, et le bouton propose de le rendre', async () => {
        // Le joint entier : bouton → controls → player → nativeVideo → élément. Les deux
        // sens, parce qu'un seul ne distinguerait pas « bascule » de « coupe toujours ».
        const w = monter()

        await bouton(w, 'Mute').trigger('click')

        expect(w.find('video').element.muted).toBe(true)
        expect(bouton(w, 'Unmute').classes()).toContain('btn-secondary')

        await bouton(w, 'Unmute').trigger('click')

        expect(w.find('video').element.muted).toBe(false)
        expect(bouton(w, 'Mute').classes()).toContain('btn-primary')
    })

    it('⭐ mon propre flux n\'offre pas de bouton Mute, et son <video> est muet d\'office', () => {
        // Sinon je m'entends moi-même : l'écho a déjà été subi. Les deux autres boutons
        // restent — le plein écran de son propre flux a du sens.
        const w = monter({ streamData: flux('Moi', { isMe: true }) })

        expect(libelles(w)).toEqual(['Fullscreen', 'PIP'])
        expect(w.find('video').element.muted).toBe(true)
    })

    it('⭐ le pool réattribue la vignette : le mute natif du flux précédent ne suit pas le suivant', async () => {
        // Ce cas EXIGE le vrai lecteur : le reset repasse par la prop `:muted`, donc c'est
        // Vue qui repatche `el.muted`. Un stub sans ce binding rendrait le cas rouge sur du
        // code correct.
        const w = monter()
        await bouton(w, 'Mute').trigger('click')
        expect(w.find('video').element.muted).toBe(true)

        await w.setProps({ streamData: flux('Bob') })

        expect(w.find('video').element.muted).toBe(false)
        expect(libelles(w)).toContain('Mute')
    })
})

describe('MediaBroadcastPlayer — le PiP porte sur la vignette où l\'on clique', () => {

    it('⭐ deux vignettes du pool : mettre la seconde en PiP ne referme pas celle de la première', async () => {
        // Deux vignettes, parce que le pool en rend une par flux et qu'il n'a pas de
        // plafond : avec une seule, « bascule le mien » et « ferme celui de tout le
        // monde » donnent le même vert.
        const [a, b] = [monter(), monter()]

        await bouton(a, 'PIP').trigger('click')
        await bouton(b, 'PIP').trigger('click')

        expect(document.pictureInPictureElement).toBe(b.find('video').element)
    })

    it('le plein écran demandé porte sur le <video>, pas sur le cadre déplaçable', async () => {
        const w = monter()

        await bouton(w, 'Fullscreen').trigger('click')

        expect(document.fullscreenElement).toBe(w.find('video').element)
        expect(document.fullscreenElement).not.toBe(w.element)
    })
})

describe('MediaBroadcastPlayer — le recyclage d\'un slot rend le player', () => {

    it('⭐ le pool réattribue la vignette : la fenêtre PiP du flux précédent se ferme', async () => {
        // Sans ça, la fenêtre PiP ouverte « sur Alice » affiche le flux de Bob sans le
        // dire — et la vignette étant masquée par le pool (`v-show`), plus aucun bouton ne
        // la ferme.
        const w = monter()
        await bouton(w, 'PIP').trigger('click')
        expect(document.pictureInPictureElement).not.toBe(null)

        await w.setProps({ streamData: flux('Bob') })

        expect(document.pictureInPictureElement).toBe(null)
    })

    it('⭐ le pool réattribue la vignette : le plein écran du flux précédent est quitté', async () => {
        const w = monter()
        await bouton(w, 'Fullscreen').trigger('click')
        expect(document.fullscreenElement).not.toBe(null)

        await w.setProps({ streamData: flux('Bob') })

        expect(document.fullscreenElement).toBe(null)
    })
})

describe('MediaBroadcastPlayer — le son coupé survit à l\'extinction de la caméra', () => {

    it('⭐ le pair éteint sa caméra : le son reste coupé sur la branche audio', async () => {
        // La boucle VIDEO_ACTIVE_TOGGLE fait passer `videoActive` à false quand le pair
        // coupe sa caméra. Le bouton Mute n'existe pas sur la branche audio : si le mute
        // ne suivait pas, on réentendrait le pair sans pouvoir le recouper depuis notre UI
        // (l'<audio> porte ses contrôles natifs, c'est la voie de retour).
        const w = monter()
        await bouton(w, 'Mute').trigger('click')
        expect(w.find('video').element.muted).toBe(true)

        await w.setProps({ videoActive: false })

        expect(w.find('audio').element.muted).toBe(true)
    })
})

describe('MediaBroadcastPlayer — ce que voit un consommateur de slots', () => {

    it('un consommateur qui fournit son propre #video garde trois boutons, et ils ne prétendent rien', async () => {
        // `ref="player"` n'est alors jamais posé : c'est le chemin par lequel la sentinelle
        // `null` est atteignable depuis le contrat public. Le <video> du consommateur est
        // équipé par `monter()` — ce qui décide doit être l'absence de ref, pas l'absence
        // d'une méthode sur son élément.
        const w = monter({}, { video: '<video class="mon-video" />' })

        await bouton(w, 'Fullscreen').trigger('click')
        await bouton(w, 'PIP').trigger('click')
        await bouton(w, 'Mute').trigger('click')

        expect(libelles(w)).toEqual(['Mute', 'Fullscreen', 'PIP'])
        expect(document.fullscreenElement).toBe(null)
        expect(document.pictureInPictureElement).toBe(null)
        expect(trace).not.toHaveBeenCalled()
    })

    it('le #controls du consommateur reçoit de quoi couper le son, et ça coupe le vrai <video>', async () => {
        const w = monter({}, {
            controls: '<button class="mien" @click="params.controls.toggleNativeMute()">coupe</button>',
        })

        await w.find('button.mien').trigger('click')

        expect(w.find('video').element.muted).toBe(true)
    })

    it('le même #controls sur un flux AUDIO ne coupe rien', async () => {
        // La paire avec le cas précédent est la seule preuve que masquer les boutons sur
        // la branche audio est une NÉCESSITÉ et non une préférence : `useMediaControls`
        // pilote `nativeVideo`, que l'AudioPlayer n'expose pas.
        const w = monter({ videoActive: false }, {
            controls: '<button class="mien" @click="params.controls.toggleNativeMute()">coupe</button>',
        })

        await w.find('button.mien').trigger('click')

        expect(w.find('audio').element.muted).toBe(false)
    })
})
