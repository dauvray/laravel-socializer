/**
 * useMediaControls.test.js — les contrôles navigateur d'une vignette
 *
 * Plein écran, Picture-in-Picture et mute **natif** de l'élément. Ce composable ne connaît
 * ni pair, ni signal, ni store : il ne touche que l'élément DOM qu'on lui passe. Son voisin
 * `useRemotePeerState` porte le mute ANNONCÉ par le pair, qui est une autre affaire — les
 * confondre a déjà coûté un énoncé de tâche faux.
 *
 * Choix d'infra
 * ─────────────
 * • **Appel nu, pas de `withSetup`.** Le composable n'enregistre aucun hook et n'injecte
 *   rien : le passer dans `withSetup` masquerait le fait qu'il est pur (règle du paquet,
 *   `docs/architecture/tests.md`).
 * • **`helpers/fakeFullscreen.js`** fabrique les six membres que happy-dom n'a pas. Son
 *   invariant — un emplacement unique par fonctionnalité, lu par des accesseurs — est ce
 *   qui rend impossible le DOM menteur où un élément serait en plein écran sans que
 *   `document.fullscreenElement` le dise. Lire son en-tête avant d'y toucher.
 * • **Élément attaché au `body`.** Un vrai `requestFullscreen` sur un élément détaché
 *   rejette : fabriquer un scénario que le navigateur refuse ferait passer les tests pour
 *   la mauvaise raison. L'helper le refuse d'ailleurs.
 * • **La sortie par Échap et la fermeture de la fenêtre PiP se simulent en appelant
 *   `document.exit*()` depuis le test.** C'est fidèle : la seule chose que la production
 *   observe est l'emplacement, et le navigateur le vide dans les deux cas. Elle n'écoute
 *   ni `fullscreenchange` ni `leavepictureinpicture` — c'est précisément ce que ces cas
 *   épinglent.
 * • **Les cas d'échec vivent ici et pas au niveau composant** : là-bas `console.error`
 *   n'est pas discriminant, `callWithAsyncErrorHandling` journalisant déjà le rejet d'un
 *   handler. « Notre `catch` a tracé » et « Vue a tracé à sa place » y donnent le même vert.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ──────────────────
 *
 * Format : `ici` = cas rouges de ce fichier, `composant` = cas rouges de
 * `MediaBroadcastPlayer.controls.test.js`, mesurés dans la même passe.
 *
 *  garde `if (!el)` de toggleFullscreen retirée ............ 1 ici · 1 composant
 *  garde `if (!el)` de togglePip retirée ................... 1 ici · 1 composant
 *  garde `if (!el)` de releasePresentation retirée ......... 1 ici · 0 composant
 *  garde `if (!el) return null` de toggleNativeMute ........ 2 ici · 2 composant
 *  `=== el` de togglePip ramené à l'état d'avant ........... 1 ici · 1 composant
 *  `=== el` de releasePresentation (PiP) élargi ............ 1 ici · 0 composant
 *  `=== el` de releasePresentation (plein écran) élargi .... 1 ici · 0 composant
 *  `el.muted = !el.muted` figé à `= true` .................. 2 ici · 1 composant
 *  `return el.muted` remplacé par `return null` ............ 2 ici · 3 composant
 *  try/catch de toggleFullscreen retiré EN ENTIER .......... 1 ici · 0 composant
 *  try/catch de togglePip retiré EN ENTIER ................. 1 ici · 0 composant
 *  message du plein écran rendu générique ................. 1 ici · 0 composant
 *  message du PiP rendu générique ......................... 1 ici · 0 composant
 *  _getEl lisant `nativeVideo ?? nativeAudio` .............. 1 ici · 1 composant
 *
 * ⚠️ Les deux contrôles de `catch` doivent retirer le `try` AVEC lui. Vider le corps du
 * catch laisse la suite compiler mais ne mesure rien, et le retirer seul laisse un `try`
 * orphelin : la suite ne compile plus, et « 0 cas rouge » se lit alors comme « ce catch ne
 * sert à rien ». Première mesure de cette passe, non exploitable, refaite.
 *
 * Trois zéros mesurés, tous sur référence relue verte (28 cas), trois passes :
 *  • **écritures de `isFullscreen` ⇒ 0 · écritures de `isPip` ⇒ 0.** C'est ce qui a
 *    autorisé leur retrait (sortie B) : deux drapeaux qu'aucun template ne lisait et
 *    qu'aucun listener ne mettait à jour, donc faux dès une sortie par Échap. Les cas
 *    « Échap puis reclic » et « fenêtre PiP refermée puis reclic » prouvent que le
 *    comportement qu'ils prétendaient décrire est intact sans eux.
 *  • **`?? null` de `_getEl` retiré ⇒ 0 ici, 0 au composant — et CONSERVÉ.** La sortie B
 *    est pour une ligne qui MENTE, pas pour toute ligne immesurable : `?? null` est le
 *    contrat écrit de `_getEl`, lu par quatre gardes. Le zéro est écrit ici pour ne pas
 *    le re-mesurer dans six mois.
 *  • **`nativeVideo` renommé chez `~estarter/VideoPlayer.vue` ⇒ 0 ici, 8 au composant.**
 *    C'est la mesure qui interdit de stuber le lecteur : le `ref({ nativeVideo })` fait
 *    main de ce fichier est AVEUGLE au renommage — il valide sa propre orthographe. Le
 *    joint de nom se garde en montant le vrai composant, jamais ici.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { useMediaControls } from '~socializer/components/WebRTC2/Widgets/Mediaplayer/Composables/useMediaControls.js'
import { installPresentationApis } from './helpers/fakeFullscreen.js'

let scene
let trace

/** Élément média attaché au document et équipé des méthodes de demande. */
const media = (tag = 'video') => {
    const el = document.createElement(tag)
    document.body.appendChild(el)
    return scene.equip(el)
}

/** Les contrôles d'un élément, tels que le composant les câble : par la clé exposée. */
const controlesDe = (el, cle = 'nativeVideo') => useMediaControls(ref(el ? { [cle]: el } : null))

beforeEach(() => {
    scene = installPresentationApis()
    trace = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    scene.restore()
    trace.mockRestore()
    document.body.innerHTML = ''
})

describe('useMediaControls — quand il n\'y a rien à piloter', () => {

    it('⭐ le mute natif rend la sentinelle « null » que lit la vignette', () => {
        // C'est le seul retour observable des trois verbes, et son lecteur unique
        // (`onToggleNativeMute`) le distingue de `false` — qui veut dire « démuté ».
        expect(controlesDe(null).toggleNativeMute()).toBe(null)
    })

    it('la demande de plein écran ne fait rien, et ne trace rien', async () => {
        await controlesDe(null).toggleFullscreen()

        expect(document.fullscreenElement).toBe(null)
        expect(trace).not.toHaveBeenCalled()
    })

    it('la demande de PiP ne fait rien, et ne trace rien', async () => {
        await controlesDe(null).togglePip()

        expect(document.pictureInPictureElement).toBe(null)
        expect(trace).not.toHaveBeenCalled()
    })

    it('rendre l\'élément ne fait rien, et ne trace rien', async () => {
        await controlesDe(null).releasePresentation()

        expect(trace).not.toHaveBeenCalled()
    })

    it('⭐ un lecteur AUDIO est traité comme absent : il n\'expose pas de vidéo native', async () => {
        // `AudioPlayer` expose `nativeAudio`, pas `nativeVideo` : la sentinelle est donc
        // STRUCTURELLE sur toute la branche audio, slot ou pas. L'élément est équipé
        // exprès — ce qui décide doit être la clé exposée, jamais l'absence d'une méthode.
        const el = media('audio')
        const controles = controlesDe(el, 'nativeAudio')

        await controles.toggleFullscreen()

        expect(document.fullscreenElement).toBe(null)
        expect(controles.toggleNativeMute()).toBe(null)
        expect(el.muted).toBe(false)
    })
})

describe('useMediaControls — le mute du navigateur', () => {

    it('⭐ couper le son de l\'élément puis le rendre : l\'élément suit, et l\'appel rend l\'état atteint', () => {
        const el = media()
        const controles = controlesDe(el)

        expect(controles.toggleNativeMute()).toBe(true)
        expect(el.muted).toBe(true)

        expect(controles.toggleNativeMute()).toBe(false)
        expect(el.muted).toBe(false)
    })

    it('le mute natif se lit sur l\'élément, il ne mémorise rien', () => {
        // L'élément arrive déjà muté par le binding `:muted` du composant (mon propre
        // flux, ou une instance recyclée). Une bascule doit partir de CET état, sinon le
        // composable serait inutilisable sur un élément qu'il ne possède pas seul.
        const el = media()
        el.muted = true

        expect(controlesDe(el).toggleNativeMute()).toBe(false)
        expect(el.muted).toBe(false)
    })
})

describe('useMediaControls — le PiP porte sur SA vignette', () => {

    it('⭐ mettre la SECONDE vignette en PiP pendant que la première y est ne referme pas la première', async () => {
        // Deux vignettes : le pool en rend une par flux, chacune avec son bouton PIP.
        // Avec une seule, « ferme le PiP de tout le monde » et « bascule le mien »
        // donneraient le même vert.
        const [elA, elB] = [media(), media()]
        const b = controlesDe(elB)

        await controlesDe(elA).togglePip()
        expect(document.pictureInPictureElement).toBe(elA)

        await b.togglePip()

        expect(document.pictureInPictureElement).toBe(elB)
    })

    it('recliquer sur la vignette DÉJÀ en PiP referme sa fenêtre', async () => {
        // Sans ce cas, « cible précise » et « n'en sort jamais » donneraient le même vert.
        const el = media()
        const controles = controlesDe(el)
        await controles.togglePip()

        await controles.togglePip()

        expect(document.pictureInPictureElement).toBe(null)
    })

    it('⭐ refermer la fenêtre PiP hors de l\'application, puis recliquer, la rouvre', async () => {
        // Le comportement que `isPip` prétendait décrire : la production ne mémorise pas
        // d'état, elle relit l'emplacement à chaque clic. C'est ce qui la rend juste alors
        // qu'elle n'écoute pas `leavepictureinpicture`.
        const el = media()
        const controles = controlesDe(el)
        await controles.togglePip()

        await document.exitPictureInPicture() // l'utilisateur ferme la fenêtre
        await controles.togglePip()

        expect(document.pictureInPictureElement).toBe(el)
    })
})

describe('useMediaControls — le plein écran', () => {

    it('la demande porte sur l\'élément média, celui qu\'on lui a passé', async () => {
        const [elA, elB] = [media(), media()]

        await controlesDe(elB).toggleFullscreen()

        expect(document.fullscreenElement).toBe(elB)
        expect(document.fullscreenElement).not.toBe(elA)
    })

    it('⭐ sortir par Échap puis recliquer remet la vignette en plein écran', async () => {
        // Pendant du cas PiP ci-dessus, pour `isFullscreen`. Aucun listener
        // `fullscreenchange` n'existe : c'est la relecture de l'emplacement à chaque clic
        // qui tient, et c'est elle qui a rendu les deux drapeaux inutiles.
        const el = media()
        const controles = controlesDe(el)
        await controles.toggleFullscreen()

        await document.exitFullscreen() // Échap
        await controles.toggleFullscreen()

        expect(document.fullscreenElement).toBe(el)
    })
})

describe('useMediaControls — rendre l\'élément au recyclage du pool', () => {

    it('⭐ l\'élément sort du PiP et du plein écran qu\'il détenait', async () => {
        const el = media()
        const controles = controlesDe(el)
        await controles.togglePip()
        await controles.toggleFullscreen()

        await controles.releasePresentation()

        expect(document.pictureInPictureElement).toBe(null)
        expect(document.fullscreenElement).toBe(null)
    })

    it('⭐ il ne touche pas la présentation d\'une AUTRE vignette', async () => {
        // Les `exit*` sont des méthodes de `document` : sans la garde `=== el`, recycler
        // un slot fermerait le PiP du voisin. Deux vignettes sont indispensables — avec
        // une seule, « ferme le mien » et « ferme celui de tout le monde » sont le même vert.
        const [elA, elB] = [media(), media()]
        await controlesDe(elA).togglePip()
        await controlesDe(elA).toggleFullscreen()

        await controlesDe(elB).releasePresentation()

        expect(document.pictureInPictureElement).toBe(elA)
        expect(document.fullscreenElement).toBe(elA)
    })
})

describe('useMediaControls — quand le navigateur refuse', () => {

    it('⭐ un plein écran refusé laisse la page comme elle était, et la cause est tracée comme un plein écran', async () => {
        // Le refus est le cas normal hors geste utilisateur. La promesse rendue doit se
        // résoudre : c'est ce que le handler `@click` attend, et « le rejet s'échappe-t-il ? »
        // n'est pas testable à travers un double.
        const el = media()
        scene.refuseNext('fullscreen')

        await expect(controlesDe(el).toggleFullscreen()).resolves.toBeUndefined()

        expect(document.fullscreenElement).toBe(null)
        expect(trace.mock.calls.at(-1)[0]).toContain('Fullscreen')
    })

    it('un PiP refusé se trace comme un PiP, pas comme un plein écran', async () => {
        // Deux causes distinctes, et non une : asserter « les deux messages diffèrent »
        // ne prouverait pas lequel dit vrai.
        const el = media()
        scene.refuseNext('pip')

        await expect(controlesDe(el).togglePip()).resolves.toBeUndefined()

        expect(document.pictureInPictureElement).toBe(null)
        expect(trace.mock.calls.at(-1)[0]).toContain('PIP')
    })
})
