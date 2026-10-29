/**
 * createPlaceholderVideoTrack.js — La piste vidéo qui tient la place d'une caméra coupée
 *
 * Une caméra coupée est ÉTEINTE (voyant compris), mais l'appel garde une piste vidéo : c'est
 * elle qui fait une offre ou une réponse `sendrecv`, sans laquelle « activer la caméra » ne
 * pourrait plus rien envoyer sans renégociation, que PeerJS ne fait pas. Elle tient aussi sa
 * place sur chaque sender (`RTCRtpSender.replaceTrack`), et c'est ce que le pair voit.
 *
 * Ce qu'il voit a été mesuré dans Chromium 149 headless, le 2026-10-29, après le remplacement
 * de la caméra sur le sender :
 *
 *   | Remplaçante                                  | Le pair voit                      |
 *   |----------------------------------------------|-----------------------------------|
 *   | `null`                                       | la dernière image, FIGÉE          |
 *   | canvas qui ne produit aucune image           | la dernière image, FIGÉE          |
 *   | canvas désactivé qui produit des images      | du noir — quelle que soit la      |
 *   |                                              | couleur peinte (rouge : noir)     |
 *   | canvas ACTIVÉ peint en rouge (contrôle)      | du rouge                          |
 *
 * ⚠️ La piste doit donc être DÉSACTIVÉE (c'est ce qui fait le noir) ET ALIMENTÉE EN IMAGES : sans
 * image, le décodeur d'en face garde la dernière reçue, et l'utilisateur qui vient de couper sa
 * caméra resterait affiché. Une image est demandée une fois par seconde : une image unique perdue
 * en route laisserait la même image figée, et le pair qui réclame une image clé n'en obtient une
 * que si la source en produit. La peinture noire n'est qu'une seconde ceinture.
 *
 * ⚠️ **`requestFrame` n'est pas au même endroit selon le navigateur** (mesuré par la relecture du
 * 2026-10-29) : sur la PISTE dans Chromium (`CanvasCaptureMediaStreamTrack`), sur le FLUX dans
 * Firefox 151 (`CanvasCaptureMediaStream`). L'appeler sur la piste levait `TypeError` sous
 * Firefox ; avec le repli sur le flux, le pair y voit du noir après ~110 ms. happy-dom a la forme
 * Chromium : la forme Firefox est doublée par `usePeerOrchestrator.calls.test.js`. Si aucun des
 * deux n'existe, la fonction LÈVE, et l'appelant échoue fermé (`usePeerMedia._createPlaceholder`).
 *
 * Le minuteur s'arrête de lui-même quand la piste est arrêtée — `stop()` n'émet pas `ended`.
 */
const PLACEHOLDER_WIDTH = 320
const PLACEHOLDER_HEIGHT = 240
const PLACEHOLDER_REPAINT_MS = 1000

/**
 * @returns {MediaStreamTrack} une piste vidéo noire, désactivée, sans périphérique derrière
 */
export function createPlaceholderVideoTrack() {
    const canvas = document.createElement('canvas')
    canvas.width = PLACEHOLDER_WIDTH
    canvas.height = PLACEHOLDER_HEIGHT

    // `null` sous happy-dom, qui n'a pas de rendu : la piste existe quand même.
    const painter = canvas.getContext('2d')
    const paint = () => {
        if (!painter) return
        painter.fillStyle = '#000'
        painter.fillRect(0, 0, PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT)
    }

    // `0` : aucune capture automatique, chaque image est demandée par `requestFrame`.
    const capture = canvas.captureStream(0)
    const [track] = capture.getVideoTracks()
    track.enabled = false

    const requestFrame = typeof track.requestFrame === 'function'
        ? () => track.requestFrame()
        : () => capture.requestFrame()

    try {
        paint()
        requestFrame()
    } catch (error) {
        track.stop()
        throw error
    }

    const repaint = setInterval(() => {
        if (track.readyState === 'ended') {
            clearInterval(repaint)
            return
        }
        paint()
        requestFrame()
    }, PLACEHOLDER_REPAINT_MS)

    return track
}
