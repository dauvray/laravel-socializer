/**
 * GroupLocalStreamBtn.test.js
 *
 * L'adaptateur entre les deux panneaux de boutons et l'API WebRTC2 : il ne rend aucun
 * bouton lui-même, il compose `LocalStreamBtn` + `LocalCaptureBtn`, leur passe l'état et
 * convertit leurs événements en appels de verbes.
 *
 * Il porte en plus la seule logique du fichier : **annoncer aux autres pairs qu'on vient de
 * couper son micro ou sa caméra** (`AUDIO_MUTE_TOGGLE` / `VIDEO_ACTIVE_TOGGLE`), consommés à
 * l'autre bout par `useRemotePeerState`.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * **Les deux enfants sont montés POUR DE VRAI, pas stubés.** Les stuber reviendrait à
 * asserter les noms d'événements de son propre stub, alors que c'est justement la couture
 * qui est en jeu : `LocalStreamBtn` parle snake_case et `LocalCaptureBtn` kebab-case, et ce
 * fichier est le SEUL endroit du dépôt où les deux se croisent. Un stub rendrait le
 * croisement invisible — le piège « un mock qui ment » du paquet.
 *
 * Le double d'API vient de `helpers/createMediaApiDouble.js`, qui porte la liste de ses
 * fidélités et les raisons de chacune. Les deux qui comptent ici : les bascules sont
 * **synchrones** et écrivent le même objet que lisent `isMuted`/`isVideoEnabled` (sans quoi
 * « l'annonce porte l'état d'après » serait vert par accident), et `currentRoom` est un
 * **leurre** distinct d'`onAirRoom` (sans quoi « la bonne room » et « une room » sont le
 * même vert).
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-30 ────────
 *
 *    1. `sendData` retiré de `onToggleAudioMute` SEUL ..................... 5 cas
 *    2. `sendData` retiré de `onToggleVideoVisibility` SEUL ............... 2 cas
 *    3. `onAirRoom.value` remplacé par `currentRoom.value` ................ 1 cas
 *    4. `sendData` déplacé AVANT `toggleAudioMute()` ...................... 1 cas
 *    5. `@start_audio` recâblé sur `startWebcamStream` .................... 1 cas
 *    6. `@start-stream` recâblé sur `startWebcamStream` ................... 1 cas
 *    7. `:isStreaming` retiré du câblage .................................. 11 cas
 *    8. `props.api` remis en `required: false, default: null` ............. 1 cas
 *
 * ⚠️ **Les n° 1 et 2 sont mesurés séparément, et l'écart est le résultat.** Les deux handlers
 * sont deux copies l'une de l'autre, mais 5 cas contre 2 : la voie audio porte quatre
 * assertions transverses (la room, l'arité, l'état d'après, la non-confusion) que la voie
 * vidéo ne porte pas. Mesurés ensemble, les deux auraient donné un seul chiffre qui aurait
 * laissé croire les deux voies également couvertes. Elles ne le sont pas — c'est assumé
 * (les assertions transverses n'ont besoin que d'une voie), mais il fallait le savoir.
 *
 * ⚠️ Le n° 3 doit rougir **1 cas et pas 0**. Zéro voudrait dire que le double n'a qu'une
 * seule room, donc que le test ne distingue pas « la bonne room » de « une room » — et ce
 * serait le test qu'il faudrait réparer, pas le code. Même logique pour le n° 4 : zéro
 * signifierait que le double ne bascule pas vraiment l'état.
 *
 * ℹ️ Le n° 4 ne rougit qu'un cas parce que les deux sens vivent dans le même `it` — les
 * deux assertions tombent, le compteur n'en voit qu'une. Ce n'est pas un trou.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GroupLocalStreamBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/GroupLocalStreamBtn.vue'
import { createMediaApiDouble, VERBES_MEDIA as VERBES } from './helpers/createMediaApiDouble.js'

let api

const monter = (etatInitial) => {
    api = createMediaApiDouble(etatInitial)
    return mount(GroupLocalStreamBtn, { props: { api } })
}

const items = (w) => w.findAll('.dropdown-item')
const boutonAvecIcone = (w, icone) =>
    w.findAll('button').find((b) => b.find(`.la-${icone}`).exists())
const basculeMicro = (w) =>
    boutonAvecIcone(w, 'microphone') ?? boutonAvecIcone(w, 'microphone-slash')
const basculeVideo = (w) =>
    boutonAvecIcone(w, 'video') ?? boutonAvecIcone(w, 'video-slash')
const boutonPartage = (w) => w.findAll('button').find((b) => b.text().includes('artage'))

/** Le seul verbe attendu a été appelé une fois, et aucun autre ne l'a été. */
const seulVerbeAppele = (attendu) => {
    expect(api[attendu]).toHaveBeenCalledTimes(1)
    for (const verbe of VERBES.filter((v) => v !== attendu)) {
        expect(api[verbe], `${verbe} ne devait pas être appelé`).not.toHaveBeenCalled()
    }
}

const derniereAnnonce = () => api.sendData.mock.calls.at(-1)[0]

describe('GroupLocalStreamBtn — l\'adaptateur des boutons de flux local', () => {

    describe('câblage des actions vers les verbes', () => {
        it('« Stream vidéo » démarre la webcam', async () => {
            const w = monter()
            await items(w)[0].trigger('click')
            seulVerbeAppele('getWebcamStream')
        })

        it('« Stream audio » démarre le micro seul', async () => {
            const w = monter()
            await items(w)[1].trigger('click')
            seulVerbeAppele('getAudioStream')
        })

        it('« Stop stream » arrête la diffusion', async () => {
            const w = monter({ isStreaming: true })
            await w.find('#stop-stream-btn').trigger('click')
            seulVerbeAppele('stopStream')
        })

        it('« Partage » démarre le partage d\'écran', async () => {
            const w = monter()
            await boutonPartage(w).trigger('click')
            seulVerbeAppele('startCapture')
        })

        it('« Arrêter partage » arrête le partage d\'écran', async () => {
            const w = monter({ isCapturing: true })
            await boutonPartage(w).trigger('click')
            seulVerbeAppele('stopCapture')
        })

        it('la bascule micro bascule le micro', async () => {
            const w = monter({ isStreaming: true })
            await basculeMicro(w).trigger('click')
            seulVerbeAppele('toggleAudioMute')
        })

        it('la bascule caméra bascule la caméra', async () => {
            const w = monter({ isStreaming: true })
            await basculeVideo(w).trigger('click')
            seulVerbeAppele('toggleVideoVisibility')
        })

        it('⭐ aucun chemin de l\'interface n\'atteint `stopAudio`', async () => {
            // `stopAudio` reste dans la surface publique de `useMediaBroadcast` — une app hôte
            // peut l'appeler — mais il n'a plus AUCUN site d'appel dans le paquet : le câblage
            // `@stop_audio` d'ici et l'émetteur `onStopAudioCall` de `LocalStreamBtn` étaient
            // morts et ont été supprimés (sortie B). Rien n'est perdu : « Stop stream » couvre
            // le flux audio seul, et en aval `stopAudioStream` n'est qu'un alias de
            // `stopWebcamStream` (`usePeerOrchestrator.js:291`).
            const horsDiffusion = monter()
            for (const el of [...horsDiffusion.findAll('.dropdown-item'), ...horsDiffusion.findAll('button')]) {
                await el.trigger('click')
            }
            const enDiffusion = monter({ isStreaming: true, isCapturing: true })
            for (const el of enDiffusion.findAll('button')) {
                await el.trigger('click')
            }

            expect(api.stopAudio).not.toHaveBeenCalled()
        })
    })

    describe('annonce de l\'état de ses pistes aux autres pairs', () => {
        it('⭐ couper son micro le dit aux autres', async () => {
            const w = monter({ isStreaming: true })

            await basculeMicro(w).trigger('click')

            expect(api.toggleAudioMute).toHaveBeenCalledTimes(1)
            expect(api.sendData).toHaveBeenCalledTimes(1)
            expect(derniereAnnonce()).toMatchObject({ type: 'AUDIO_MUTE_TOGGLE' })
        })

        it('⭐ l\'annonce porte l\'état d\'APRÈS la bascule, dans les deux sens', async () => {
            // Si l'annonce partait avant la bascule, elle dirait toujours l'inverse de la
            // vérité. Les deux sens sont nécessaires : à sens unique, « l'état d'après » et
            // « la constante true » donnent le même vert.
            const ouvert = monter({ isStreaming: true, isMuted: false })
            await basculeMicro(ouvert).trigger('click')
            expect(derniereAnnonce().isMuted).toBe(true)

            const coupe = monter({ isStreaming: true, isMuted: true })
            await basculeMicro(coupe).trigger('click')
            expect(derniereAnnonce().isMuted).toBe(false)
        })

        it('⭐ couper sa caméra le dit aux autres, dans les deux sens', async () => {
            const active = monter({ isStreaming: true, isVideoEnabled: true })
            await basculeVideo(active).trigger('click')
            expect(derniereAnnonce()).toMatchObject({ type: 'VIDEO_ACTIVE_TOGGLE', isActive: false })

            const coupee = monter({ isStreaming: true, isVideoEnabled: false })
            await basculeVideo(coupee).trigger('click')
            expect(derniereAnnonce()).toMatchObject({ type: 'VIDEO_ACTIVE_TOGGLE', isActive: true })
        })

        it('⭐ les deux annonces ne se confondent jamais', async () => {
            // Les deux handlers sont deux copies : un copier-coller du `type:` entre eux serait
            // invisible sans cette assertion croisée.
            const micro = monter({ isStreaming: true })
            await basculeMicro(micro).trigger('click')
            expect(derniereAnnonce().type).toBe('AUDIO_MUTE_TOGGLE')
            expect(derniereAnnonce()).not.toHaveProperty('isActive')

            const camera = monter({ isStreaming: true })
            await basculeVideo(camera).trigger('click')
            expect(derniereAnnonce().type).toBe('VIDEO_ACTIVE_TOGGLE')
            expect(derniereAnnonce()).not.toHaveProperty('isMuted')
        })

        it('⭐ l\'annonce part dans la room où je suis à l\'antenne', async () => {
            // `onAirRoom` et non `currentRoom` : le leurre existe pour que ce cas distingue
            // « la bonne room » de « une room ».
            const w = monter({ isStreaming: true })

            await basculeMicro(w).trigger('click')

            expect(derniereAnnonce().roomId).toBe('room-a-l-antenne')
            expect(derniereAnnonce().roomId).not.toBe('room-logique')
        })

        it('l\'annonce part sans destinataire nommé', async () => {
            // Arité 1 : un second argument restreindrait silencieusement l'audience de
            // l'annonce à une liste de slugs (cf. le défaut `destUserSlugs` de `sendData`).
            const w = monter({ isStreaming: true })

            await basculeMicro(w).trigger('click')

            expect(api.sendData.mock.calls[0]).toHaveLength(1)
        })
    })

    describe('l\'état traverse jusqu\'aux boutons', () => {
        it('⭐ la diffusion en cours change ce que proposent les boutons', async () => {
            const w = monter({ isStreaming: false })
            expect(w.find('#stop-stream-btn').exists()).toBe(false)
            expect(items(w)).toHaveLength(2)

            api.isStreaming.value = true
            await w.vm.$nextTick()

            expect(w.find('#stop-stream-btn').exists()).toBe(true)
            expect(items(w)).toHaveLength(0)
        })

        it('le partage en cours change ce que propose le bouton de capture', async () => {
            const w = monter({ isCapturing: false })
            expect(boutonPartage(w).text()).toContain('Partage')

            api.isCapturing.value = true
            await w.vm.$nextTick()

            expect(boutonPartage(w).text()).toContain('Arrêter partage')
        })

        it('⭐ l\'état des deux pistes traverse jusqu\'aux icônes', async () => {
            const w = monter({ isStreaming: true, isMuted: false, isVideoEnabled: true })
            expect(basculeMicro(w).find('.la-microphone-slash').exists()).toBe(true)
            expect(basculeVideo(w).find('.la-video-slash').exists()).toBe(true)

            api._etats.isMuted = true
            api._etats.isVideoEnabled = false
            await w.vm.$nextTick()

            expect(basculeMicro(w).find('.la-microphone').exists()).toBe(true)
            expect(basculeVideo(w).find('.la-video').exists()).toBe(true)
        })
    })

    describe('sans API', () => {
        let avertissements

        beforeEach(() => {
            avertissements = []
            vi.spyOn(console, 'warn').mockImplementation((m) => avertissements.push(String(m)))
        })

        it('⭐ un panneau sans API le dit, au lieu de casser sans nommer la cause', () => {
            // Le template déréférence `props.api.isStreaming.value` dès le rendu : sans API, le
            // montage échoue de toute façon. Ce qui se joue ici est le DIAGNOSTIC — « Missing
            // required prop: api » plutôt qu'un `Cannot read properties of null` opaque, à trois
            // composants de distance du câblage fautif.
            expect(() => mount(GroupLocalStreamBtn)).toThrow()

            expect(avertissements.join('\n')).toMatch(/Missing required prop.*api/s)
        })
    })
})
