/**
 * fakeMedia.js — Flux média factices, mais de vraies instances MediaStream
 *
 * ⚠️ Le flux global installé par `setup.js` est un **objet nu**, or tout le code de
 * production filtre sur `stream instanceof MediaStream` avant d'ouvrir une connexion
 * (`connectToPeer`, `_canEmitStreamFor`, `_bindStreamCleanup`…). Un objet nu produit
 * donc un scénario silencieusement inerte : aucune connexion média n'est ouverte, et
 * le test échoue pour une raison qui n'a rien à voir avec ce qu'il teste.
 *
 * happy-dom expose bien la classe `MediaStream` mais n'implémente pas `getTracks()`,
 * et `MediaStreamTrack` a un constructeur illégal — d'où la surcharge de `getTracks`
 * sur l'instance plutôt qu'un `new MediaStreamTrack()`.
 */
import { vi } from 'vitest'

/**
 * Piste factice : expose ce que lit le code (`readyState`, `stop`, `kind`) avec un vrai
 * registre de listeners, pour pouvoir simuler la fin de vie d'un flux (`ended`).
 *
 * PLUSIEURS écouteurs par événement, retirés un par un, avec `{ once }`, comme une vraie piste :
 * le registre n'en gardait qu'un, et deux écouteurs `ended` sur la même caméra (le nettoyage du
 * player et le suivi de la caméra) n'en voyaient qu'un en test. `stop()` n'émet rien, comme dans
 * le navigateur : seul `_emit` simule un arrêt venu du périphérique.
 */
export function fakeTrack(kind = 'video') {
    const listeners = {}
    return {
        kind,
        enabled: true,
        readyState: 'live',
        stop: vi.fn(function stop() { this.readyState = 'ended' }),
        addEventListener: vi.fn((event, handler, options) => {
            const list = listeners[event] ?? (listeners[event] = [])
            if (!list.some((entry) => entry.handler === handler)) {
                list.push({ handler, once: options === true ? false : !!options?.once })
            }
        }),
        removeEventListener: vi.fn((event, handler) => {
            if (!listeners[event]) return
            listeners[event] = handler === undefined
                ? []
                : listeners[event].filter((entry) => entry.handler !== handler)
        }),
        dispatchEvent: vi.fn(),
        /** Déclenche un événement de piste (ex. arrêt natif du partage d'écran, caméra débranchée). */
        _emit(event) {
            if (event === 'ended') this.readyState = 'ended'
            const list = [...(listeners[event] ?? [])]
            listeners[event] = (listeners[event] ?? []).filter((entry) => !entry.once)
            list.forEach((entry) => entry.handler())
        },
        _has(event) { return (listeners[event] ?? []).length > 0 },
    }
}

/**
 * Vraie instance `MediaStream` (donc `instanceof` OK) dont on pilote les pistes.
 *
 * `addTrack` / `removeTrack` écrivent dans la MÊME liste que lisent les accesseurs : ceux de
 * happy-dom écrivent dans une liste interne que les accesseurs surchargés ne voient pas, et une
 * piste remplacée en place (la caméra coupée) n'aurait jamais quitté le flux.
 */
export function realStream(tracks = [fakeTrack()]) {
    const stream = new MediaStream()
    stream.getTracks = () => tracks
    stream.getVideoTracks = () => tracks.filter((t) => t.kind === 'video')
    stream.getAudioTracks = () => tracks.filter((t) => t.kind === 'audio')
    stream.addTrack = (track) => { if (!tracks.includes(track)) tracks.push(track) }
    stream.removeTrack = (track) => {
        const index = tracks.indexOf(track)
        if (index !== -1) tracks.splice(index, 1)
    }
    return stream
}

/**
 * Fait rendre à `getUserMedia` / `getDisplayMedia` un flux neuf à chaque appel.
 *
 * ⚠️ `mockReset()` est indispensable : `vitest.config.js` n'active pas `clearMocks`,
 * donc les `vi.fn()` globaux de `setup.js` conservent leurs compteurs et leur
 * implémentation d'un test à l'autre.
 *
 * Chaque appel retourne une instance **distincte** : deux pairs qui partageraient le
 * même objet `MediaStream` rendraient indétectable toute confusion de flux.
 */
export function installFakeMedia() {
    navigator.mediaDevices.getUserMedia
        .mockReset()
        .mockImplementation(async () => realStream([fakeTrack('video'), fakeTrack('audio')]))

    navigator.mediaDevices.getDisplayMedia
        .mockReset()
        .mockImplementation(async () => realStream([fakeTrack('video')]))
}
