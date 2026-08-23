/**
 * fetchIceServers.test.js
 *
 * Le contrat de `fetchIceServers` tient en une phrase : **elle ne jette jamais et rend toujours un
 * tableau non vide**. C'est ce qui autorise `usePeerTransport._doInit` à l'`await`er sans
 * `try/catch` avant `new Peer`, donc ce qui garantit qu'une panne de `/get-ice-servers` dégrade en
 * STUN au lieu de couper WebRTC dans l'onglet. Tout ce fichier vérifie cette phrase, y compris sur
 * les chemins que la route ne produit pas mais qu'un proxy ou une session expirée produiraient.
 *
 * Contrôle de harnais (convention du paquet) : neutraliser le repli — remplacer les trois
 * `return STUN_ONLY_ICE_SERVERS` par `return []` — doit faire rougir les 8 cas du bloc « replis »,
 * et EUX SEULS ; les 2 cas nominaux et les 2 cas d'hygiène du timer restent verts. Vérifié le
 * 2026-08-23.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchIceServers } from '~socializer/components/WebRTC2/Composables/utils/fetchIceServers.js'
import { ENDPOINTS, ICE_FETCH_TIMEOUT_MS, STUN_ONLY_ICE_SERVERS } from '~socializer/components/WebRTC2/webrtc2.config.js'

const TURN = { urls: 'turn:turn.example:3478', username: 'u-42', credential: 'c-42' }
const STUN = { urls: 'stun:stun.example:19302' }

/** Client minimal, façonné comme `ctx.AjaxService` (`createMockContext`). */
function makeAjax(load) {
    return { load: vi.fn(load) }
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('fetchIceServers — chemin nominal', () => {
    it('rend les iceServers de la réponse quand ils sont exploitables', async () => {
        const AjaxService = makeAjax(async () => ({ iceServers: [STUN, TURN] }))

        await expect(fetchIceServers(AjaxService)).resolves.toEqual([STUN, TURN])
    })

    it('interroge ENDPOINTS.ICE_SERVERS en GET', async () => {
        // Fige le contrat avec le backend : c'est l'URL nommée dans `routes.public.php`, et le
        // verbe qui évite le 419 → `document.location.reload()` d'`AjaxService`.
        const AjaxService = makeAjax(async () => ({ iceServers: [STUN] }))

        await fetchIceServers(AjaxService)

        expect(AjaxService.load).toHaveBeenCalledWith(ENDPOINTS.ICE_SERVERS, 'get')
    })
})

describe('fetchIceServers — replis', () => {
    it('rend STUN seul, sans jeter, quand la requête rejette', async () => {
        const AjaxService = makeAjax(async () => { throw new Error('500') })

        await expect(fetchIceServers(AjaxService)).resolves.toEqual(STUN_ONLY_ICE_SERVERS)
    })

    it.each([
        ['réponse vide', {}],
        ['réponse nulle', null],
        ['iceServers non tableau', { iceServers: 'oops' }],
        ['forme des doublures de test', { data: {} }],
    ])('rend STUN seul quand la réponse est inexploitable — %s', async (_label, payload) => {
        const AjaxService = makeAjax(async () => payload)

        await expect(fetchIceServers(AjaxService)).resolves.toEqual(STUN_ONLY_ICE_SERVERS)
    })

    it('filtre les entrées sans urls utilisable, et retombe en STUN si tout est filtré', async () => {
        // Une entrée sans `urls` n'est pas inerte : l'agent ICE la prend pour un serveur à
        // interroger et attend son échec avant de conclure.
        const partiel = makeAjax(async () => ({ iceServers: [{}, { urls: '' }, { urls: [] }, TURN] }))
        await expect(fetchIceServers(partiel)).resolves.toEqual([TURN])

        const total = makeAjax(async () => ({ iceServers: [{}, { urls: '   ' }] }))
        await expect(fetchIceServers(total)).resolves.toEqual(STUN_ONLY_ICE_SERVERS)
    })

    it('rend STUN seul, sans jeter, quand aucun client HTTP n\'est fourni', async () => {
        await expect(fetchIceServers(undefined)).resolves.toEqual(STUN_ONLY_ICE_SERVERS)
        await expect(fetchIceServers({})).resolves.toEqual(STUN_ONLY_ICE_SERVERS)
    })

    it('rend STUN seul quand la requête ne settle jamais (timeout)', async () => {
        // Le cas qui justifie le `Promise.race` : `AjaxService.load` a DEUX chemins qui ne
        // résolvent ni ne rejettent — 401/419 (`reload()`) et 302 (`location.href`). Sans timeout,
        // l'`await` de `_doInit` voudrait dire « plus jamais de Peer dans cet onglet ».
        vi.useFakeTimers()
        const AjaxService = makeAjax(() => new Promise(() => {}))

        const enVol = fetchIceServers(AjaxService)
        await vi.advanceTimersByTimeAsync(ICE_FETCH_TIMEOUT_MS)

        await expect(enVol).resolves.toEqual(STUN_ONLY_ICE_SERVERS)
    })
})

describe('fetchIceServers — hygiène du timer', () => {
    it('n\'abandonne aucun timer derrière elle sur le chemin nominal', async () => {
        // Sans le `clearTimeout` du `finally`, le perdant de la race rejetterait une promesse que
        // plus personne n'observe — vitest la remonte en `unhandledRejection`.
        vi.useFakeTimers()
        const AjaxService = makeAjax(async () => ({ iceServers: [TURN] }))

        await fetchIceServers(AjaxService)

        expect(vi.getTimerCount()).toBe(0)
    })

    it('n\'abandonne aucun timer derrière elle quand la requête rejette', async () => {
        vi.useFakeTimers()
        const AjaxService = makeAjax(async () => { throw new Error('500') })

        await fetchIceServers(AjaxService)

        expect(vi.getTimerCount()).toBe(0)
    })
})
