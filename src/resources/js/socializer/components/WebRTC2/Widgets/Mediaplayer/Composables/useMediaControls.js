/**
 * useMediaControls — plein écran, Picture-in-Picture et mute NATIF d'un élément média.
 *
 * Ne connaît ni pair, ni signal, ni store : il ne touche que l'élément qu'on lui passe,
 * via la clé `nativeVideo` que `VideoPlayer` expose. Son voisin `useRemotePeerState` porte
 * le mute ANNONCÉ par le pair, qui est une autre affaire.
 *
 * ⚠️ **Aucun drapeau d'état, et c'est une décision (31/08/2026).** `isFullscreen` et `isPip`
 * ont été retirés : personne ne les lisait, et aucun listener ne les mettait à jour — ils
 * mentaient dès une sortie par Échap ou une fermeture de la fenêtre PiP. La vérité est
 * `document.fullscreenElement` / `document.pictureInPictureElement`, relue à chaque appel,
 * et c'est ce qui rend ces trois verbes justes. Un consommateur qui voudrait un libellé
 * « Quitter le plein écran » doit poser son propre listener `fullscreenchange`, pas
 * ressusciter un drapeau que rien ne synchronise.
 *
 * Conséquence : ce module n'importe rien de Vue — aucun hook, aucun `inject`, aucun état.
 * Il s'appelle donc nu, y compris dans les tests (`docs/architecture/tests.md`).
 */
export function useMediaControls(videoRef) {

    const _getEl = () => videoRef.value?.nativeVideo ?? null

    const toggleFullscreen = async () => {
        const el = _getEl()
        if (!el) return
        try {
            if (!document.fullscreenElement) {
                await el.requestFullscreen()
            } else {
                await document.exitFullscreen()
            }
        } catch (err) {
            console.error('Fullscreen error:', err)
        }
    }

    // ⚠️ La comparaison à `el` est load-bearing : il n'y a qu'UN élément en PiP par
    // document, et le pool rend une vignette par flux. Sans elle, cliquer PIP sur la
    // vignette B pendant que A y est fermait le PiP de A sans ouvrir celui de B — deux
    // clics, et le PiP d'un tiers volé au premier.
    //
    // ⚠️ Un seul `await`, et jamais « fermer le PiP étranger PUIS ouvrir le mien » : le
    // second appel tomberait après un await, hors activation transitoire, donc en
    // `NotAllowedError` — on cumulerait les deux défauts. Demander le PiP sur B alors que
    // A l'a suffit : le navigateur échange, A reçoit `leavepictureinpicture`.
    const togglePip = async () => {
        const el = _getEl()
        if (!el) return
        try {
            if (document.pictureInPictureElement === el) {
                await document.exitPictureInPicture()
            } else {
                await el.requestPictureInPicture()
            }
        } catch (err) {
            console.error('PIP error:', err)
        }
    }

    /**
     * Rend l'élément : le sort du PiP et du plein écran, mais seulement s'il les détient.
     *
     * Le pool (`PlayerHost`) recycle l'instance ET son élément `<video>` d'un flux à
     * l'autre : sans ça, la fenêtre PiP ouverte « sur Bob » affiche le flux suivant sous
     * l'identité de Bob — et la vignette libérée étant masquée (`v-show`), plus aucun
     * bouton ne permet de la fermer.
     *
     * Même garde `=== el` que `togglePip`, pour la même raison : les `exit*` sont des
     * méthodes de `document`, elles fermeraient la présentation d'une AUTRE vignette.
     * Ni `exitFullscreen` ni `exitPictureInPicture` n'exigent d'activation transitoire :
     * les appeler hors geste utilisateur est légal.
     */
    const releasePresentation = async () => {
        const el = _getEl()
        if (!el) return
        try {
            if (document.pictureInPictureElement === el) {
                await document.exitPictureInPicture()
            }
            if (document.fullscreenElement === el) {
                await document.exitFullscreen()
            }
        } catch (err) {
            console.error('Release presentation error:', err)
        }
    }

    // mute "natif" de l'élément (différent du mute applicatif lié à isMuted).
    // Rend l'état atteint, ou `null` s'il n'y a pas d'élément à piloter — sentinelle que
    // son seul lecteur distingue de `false`, qui veut dire « démuté ».
    const toggleNativeMute = () => {
        const el = _getEl()
        if (!el) return null
        el.muted = !el.muted
        return el.muted
    }

    return {
        toggleFullscreen,
        togglePip,
        toggleNativeMute,
        releasePresentation
    }
}
