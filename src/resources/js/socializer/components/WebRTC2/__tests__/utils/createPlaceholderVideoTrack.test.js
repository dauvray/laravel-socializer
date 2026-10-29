/**
 * createPlaceholderVideoTrack.test.js
 *
 * La piste qui tient la place d'une caméra coupée. Ce que le pair en VOIT ne se mesure pas ici —
 * happy-dom ne rend rien (`getContext` rend `null`) — mais en navigateur : en-tête du fichier
 * testé. Ce qui se tient ici, c'est l'API de la capture canvas, qui n'est pas la même partout.
 *
 * ⚠️ happy-dom a la forme CHROMIUM (`requestFrame` sur la piste). La forme FIREFOX
 * (`requestFrame` sur le flux, aucune sur la piste) est doublée par `captureStream` surchargé :
 * sans ce double, la suite entière tournait sur un sosie de Chromium, et la fonction levait
 * `TypeError` sous Firefox 151 — trouvé par la relecture du 2026-10-29.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createPlaceholderVideoTrack } from '~socializer/components/WebRTC2/Composables/utils/createPlaceholderVideoTrack.js'

/** Surcharge `captureStream` pour façonner le flux rendu ; rend la liste des flux capturés. */
const surchargerCapture = (faconner) => {
    const capturer = HTMLCanvasElement.prototype.captureStream
    const flux = []
    vi.spyOn(HTMLCanvasElement.prototype, 'captureStream').mockImplementation(function (cadence) {
        const capture = capturer.call(this, cadence)
        faconner(capture, capture.getVideoTracks()[0])
        flux.push(capture)
        return capture
    })
    return flux
}

describe('createPlaceholderVideoTrack', () => {
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('rend une piste vidéo DÉSACTIVÉE, vivante, et demande une image tout de suite (forme Chromium)', () => {
        let demandes = 0
        surchargerCapture((_capture, piste) => { piste.requestFrame = () => { demandes++ } })

        const piste = createPlaceholderVideoTrack()

        expect(piste.kind).toBe('video')
        expect(piste.enabled).toBe(false)
        expect(piste.readyState).toBe('live')
        expect(demandes).toBe(1)
        piste.stop()
    })

    it('⭐ forme Firefox : demande ses images au FLUX quand la piste n\'a pas de `requestFrame`', () => {
        const captures = surchargerCapture((flux, piste) => {
            piste.requestFrame = undefined
            flux.requestFrame = vi.fn()
        })
        const piste = createPlaceholderVideoTrack()

        expect(captures[0].requestFrame).toHaveBeenCalledTimes(1)
        piste.stop()
    })

    it('ni sur la piste ni sur le flux : LÈVE, et la piste créée est arrêtée', () => {
        // L'appelant échoue alors fermé (`usePeerMedia._createPlaceholder`). Sans l'arrêt, la piste
        // canvas resterait vivante sans aucune référence pour l'arrêter.
        const pistes = []
        surchargerCapture((_flux, piste) => {
            piste.requestFrame = undefined
            pistes.push(piste)
        })

        expect(() => createPlaceholderVideoTrack()).toThrow(TypeError)
        expect(pistes[0].readyState).toBe('ended')
    })

    it('une image par seconde tant que la piste vit, plus aucune une fois arrêtée', () => {
        // Une image unique perdue en route laisserait chez le pair la dernière image de la
        // caméra, figée ; et le minuteur ne doit pas survivre à sa piste (`stop()` n'émet pas
        // `ended`, il le constate lui-même).
        vi.useFakeTimers()
        let demandes = 0
        surchargerCapture((_capture, piste) => { piste.requestFrame = () => { demandes++ } })
        const piste = createPlaceholderVideoTrack()

        vi.advanceTimersByTime(3000)
        expect(demandes).toBe(4)

        piste.stop()
        vi.advanceTimersByTime(5000)
        expect(demandes).toBe(4)
        expect(vi.getTimerCount()).toBe(0)
    })
})
