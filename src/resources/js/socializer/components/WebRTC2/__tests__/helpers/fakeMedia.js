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
 */
export function fakeTrack(kind = 'video') {
    const listeners = {}
    return {
        kind,
        enabled: true,
        readyState: 'live',
        stop: vi.fn(function stop() { this.readyState = 'ended' }),
        addEventListener: vi.fn((event, handler) => { listeners[event] = handler }),
        removeEventListener: vi.fn((event) => { delete listeners[event] }),
        dispatchEvent: vi.fn(),
        /** Déclenche un événement de piste (ex. arrêt natif du partage d'écran). */
        _emit(event) { listeners[event]?.() },
        _has(event) { return typeof listeners[event] === 'function' },
    }
}

/** Vraie instance `MediaStream` (donc `instanceof` OK) dont on pilote les pistes. */
export function realStream(tracks = [fakeTrack()]) {
    const stream = new MediaStream()
    stream.getTracks = () => tracks
    stream.getVideoTracks = () => tracks.filter((t) => t.kind === 'video')
    stream.getAudioTracks = () => tracks.filter((t) => t.kind === 'audio')
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
