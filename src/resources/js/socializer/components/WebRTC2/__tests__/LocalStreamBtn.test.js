/**
 * LocalStreamBtn.test.js
 *
 * Le panneau de commande du flux local : démarrer une diffusion, l'arrêter, basculer
 * chacune des deux pistes.
 *
 * Le composant ne décide de rien — il n'a ni store, ni état local. Il rend l'état que son
 * parent lui passe et lui redemande une action. C'est ce contrat-là qui est couvert ici,
 * plus la seule chose que le panneau affirme de son propre chef : **l'icône dit l'action à
 * venir, pas l'état courant**.
 *
 * ⚠️ Les enfants ne sont pas stubés. `IconWidget` (`~estarter`) rend `<i class="las la-{icon}">`
 * et n'a aucune dépendance : le stuber reviendrait à asserter le nom d'icône de son propre
 * stub, alors que c'est précisément la valeur rendue qui porte le fait métier.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-30 ────────
 *
 *    1. `v-if="!isStreaming"` inversé ..................................... 9 cas
 *    2. les deux `@click` du menu croisés ................................. 2 cas
 *    3. la CLASSE de la bascule vidéo figée (`'btn-primary'`) ............. 1 cas
 *    4. l'ICÔNE de la bascule vidéo figée (`v-if="false"`) ................ 2 cas
 *    5. la classe de la bascule micro figée ............................... 1 cas
 *    6. l'icône de la bascule micro figée ................................. 2 cas
 *    7. un sixième événement réintroduit (`stop_audio` sur `#stop-stream-btn`) ... 2 cas
 *
 * ⚠️ Les n° 3 à 6 sont quatre contrôles et non deux : sur chaque bascule, la classe et
 * l'icône sont **deux rendus indépendants du même drapeau, aux conditions inversées**
 * (`isVideoEnabled ? 'btn-primary' : …` mais `v-if="!isVideoEnabled"`). Les neutraliser
 * ensemble masquerait qu'un seul des deux est asserté — et c'est exactement la moitié qui
 * porte le fait contre-intuitif.
 *
 * Le n° 7 a d'abord été mesuré sur la version d'AVANT la suppression de `stop_audio` (voir
 * le dernier cas) : c'est le rouge qui autorisait à supprimer, une négative jamais vue rouge
 * ne gardant rien. Il reste valable tel quel sur la version d'après.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LocalStreamBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalStreamBtn.vue'

const monter = (isStreaming = false, streamStates = {}) =>
    mount(LocalStreamBtn, {
        props: {
            isStreaming,
            streamStates: { isMuted: false, isVideoEnabled: true, ...streamStates },
        },
    })

/** Le bouton qui porte cette icône — l'icône est la seule identité stable des bascules. */
const boutonAvecIcone = (wrapper, icone) =>
    wrapper.findAll('button').find((b) => b.find(`.la-${icone}`).exists())

const basculeMicro = (wrapper) =>
    boutonAvecIcone(wrapper, 'microphone') ?? boutonAvecIcone(wrapper, 'microphone-slash')

const basculeVideo = (wrapper) =>
    boutonAvecIcone(wrapper, 'video') ?? boutonAvecIcone(wrapper, 'video-slash')

const items = (wrapper) => wrapper.findAll('.dropdown-item')

describe('LocalStreamBtn — commande du flux local', () => {

    describe('hors diffusion', () => {
        it('propose de démarrer une diffusion, et rien d\'autre', () => {
            const wrapper = monter(false)

            expect(items(wrapper)).toHaveLength(2)
            expect(wrapper.find('#stop-stream-btn').exists()).toBe(false)
            expect(basculeMicro(wrapper)).toBeUndefined()
            expect(basculeVideo(wrapper)).toBeUndefined()
        })

        it('« Stream vidéo » demande un flux vidéo, et pas un flux audio', async () => {
            const wrapper = monter(false)

            await items(wrapper)[0].trigger('click')

            expect(wrapper.emitted('start_video')).toHaveLength(1)
            expect(wrapper.emitted('start_audio')).toBeUndefined()
        })

        it('« Stream audio » demande un flux audio, et pas un flux vidéo', async () => {
            const wrapper = monter(false)

            await items(wrapper)[1].trigger('click')

            expect(wrapper.emitted('start_audio')).toHaveLength(1)
            expect(wrapper.emitted('start_video')).toBeUndefined()
        })
    })

    describe('en diffusion', () => {
        it('propose d\'arrêter et de basculer chaque piste, et plus de menu', () => {
            const wrapper = monter(true)

            expect(wrapper.findAll('button')).toHaveLength(3)
            expect(items(wrapper)).toHaveLength(0)
            expect(wrapper.find('#stop-stream-btn').exists()).toBe(true)
        })

        it('le bouton d\'arrêt arrête la diffusion', async () => {
            const wrapper = monter(true)

            await wrapper.find('#stop-stream-btn').trigger('click')

            expect(wrapper.emitted('stop_video')).toHaveLength(1)
            expect(wrapper.emitted('stop_audio')).toBeUndefined()
        })

        it('la bascule micro demande la bascule au parent sans décider de l\'état', async () => {
            const wrapper = monter(true, { isMuted: false })
            const avant = basculeMicro(wrapper).html()

            await basculeMicro(wrapper).trigger('click')

            expect(wrapper.emitted('toggle_audio')).toHaveLength(1)
            // Les props n'ont pas bougé : le panneau n'a donc rien à afficher de nouveau.
            // C'est le parent qui détient l'état, et c'est ce qui rend ce composant rejouable.
            expect(basculeMicro(wrapper).html()).toBe(avant)
        })
    })

    describe('ce que l\'utilisateur voit de ses pistes', () => {
        it('le micro coupé se voit, sur la classe ET sur l\'icône', () => {
            const ouvert = monter(true, { isMuted: false })
            expect(basculeMicro(ouvert).find('.la-microphone-slash').exists()).toBe(true)
            expect(basculeMicro(ouvert).classes()).toContain('btn-primary')

            const coupe = monter(true, { isMuted: true })
            expect(basculeMicro(coupe).find('.la-microphone').exists()).toBe(true)
            expect(basculeMicro(coupe).classes()).toContain('btn-secondary')
        })

        it('⭐ la caméra coupée se voit, et l\'icône dit l\'action et non l\'état', () => {
            // Le point contre-intuitif du panneau : caméra ACTIVE ⇒ icône `video-slash`,
            // parce que l'icône annonce ce que le clic va faire (« couper la caméra »).
            // Lue comme un état, elle paraît inversée. La classe, elle, suit bien l'état.
            const active = monter(true, { isVideoEnabled: true })
            expect(basculeVideo(active).find('.la-video-slash').exists()).toBe(true)
            expect(basculeVideo(active).classes()).toContain('btn-primary')

            const coupee = monter(true, { isVideoEnabled: false })
            expect(basculeVideo(coupee).find('.la-video').exists()).toBe(true)
            expect(basculeVideo(coupee).classes()).toContain('btn-secondary')
        })

        it('⭐ les deux bascules sont indépendantes', () => {
            // Deux drapeaux, deux boutons : avec un seul drapeau à la fois, un rendu qui
            // lirait le mauvais drapeau donnerait le même vert la moitié du temps.
            const micDoupeCamActive = monter(true, { isMuted: true, isVideoEnabled: true })
            expect(basculeMicro(micDoupeCamActive).find('.la-microphone').exists()).toBe(true)
            expect(basculeVideo(micDoupeCamActive).find('.la-video-slash').exists()).toBe(true)

            const micOuvertCamCoupee = monter(true, { isMuted: false, isVideoEnabled: false })
            expect(basculeMicro(micOuvertCamCoupee).find('.la-microphone-slash').exists()).toBe(true)
            expect(basculeVideo(micOuvertCamCoupee).find('.la-video').exists()).toBe(true)
        })
    })

    describe('le vocabulaire d\'événements', () => {
        it('⭐ le panneau n\'en émet que cinq, et `stop_audio` n\'en fait plus partie', async () => {
            // `stop_audio` a été déclaré et émis par `onStopAudioCall` — qu'aucun élément du
            // template n'appelait. Supprimé (sortie B) après avoir vu rouge la négative qui le
            // gardait : « Stop stream » s'affiche dès que `isStreaming` est vrai, flux audio
            // seul compris, et `stopAudio` n'est qu'un alias de `stopStream` en aval
            // (`usePeerOrchestrator.stopAudioStream` appelle `stopWebcamStream`).
            //
            // L'énumération exacte remplace l'assertion négative : elle rougit aussi bien si
            // un sixième événement réapparaît que si l'un des cinq disparaît.
            // ⚠️ Piège de harnais : `emitted()` capte AUSSI les événements DOM natifs qui
            // remontent jusqu'à la racine du composant — ici `click`, à chaque `trigger`.
            // Les écarter n'affaiblit rien : ce qui est asserté est le vocabulaire que le
            // parent peut écouter en `@…`, pas le bouillonnement du DOM.
            const emis = new Set()

            for (const wrapper of [monter(false), monter(true)]) {
                for (const el of [...items(wrapper), ...wrapper.findAll('button')]) {
                    await el.trigger('click')
                }
                Object.keys(wrapper.emitted())
                    .filter((e) => e !== 'click')
                    .forEach((e) => emis.add(e))
            }

            expect([...emis].sort()).toEqual([
                'start_audio', 'start_video', 'stop_video', 'toggle_audio', 'toggle_video',
            ])
        })
    })
})
