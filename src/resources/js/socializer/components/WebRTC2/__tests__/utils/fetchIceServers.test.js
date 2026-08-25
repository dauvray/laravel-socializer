/**
 * fetchIceServers.test.js
 *
 * Le contrat de `fetchIceServers` tient en deux phrases, et ce fichier vérifie les deux.
 *
 * 1. **Elle ne jette jamais et son `iceServers` est toujours un tableau non vide.** C'est ce qui
 *    autorise `usePeerTransport._doInit` à l'`await`er sans `try/catch` avant `new Peer`, donc ce
 *    qui garantit qu'une panne de `/get-ice-servers` dégrade en STUN au lieu de couper WebRTC dans
 *    l'onglet. Y compris sur les chemins que la route ne produit pas mais qu'un proxy ou une
 *    session expirée produiraient.
 * 2. **`credentialTtlMs` ne vaut un nombre que si le serveur a répondu ET annonce un credential
 *    périssable.** `null` partout ailleurs — c'est ce qui empêche le rafraîchissement de
 *    `usePeerTransport` de remplacer une configuration TURN qui marche par le repli STUN le jour où
 *    la route répond mal.
 *
 * Contrôles de harnais (convention du paquet), mesurés le 2026-08-25 :
 *   - vider le repli (`fallback()` rendant `iceServers: []`) rougit **9 cas** : les 8 du bloc
 *     « replis » et `ignore le TTL quand les iceServers sont inexploitables`, qui assertent le même
 *     repli depuis l'autre bloc ;
 *   - retirer la garde de `toTtlMs` rougit **9 cas** aussi, mais pas les mêmes : les 6 cas de TTL
 *     inexploitable, plus les 3 qui assertent `credentialTtlMs: null` sur une réponse sans TTL
 *     (`undefined * 1000` vaut `NaN`, pas `null`). Cette collatéralité est le signe que la garde
 *     porte bien sur la conversion elle-même et non sur une liste de valeurs.
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

/** Le repli, sous la forme de retour du module. */
const REPLI = { iceServers: STUN_ONLY_ICE_SERVERS, credentialTtlMs: null }

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

        await expect(fetchIceServers(AjaxService)).resolves.toEqual({
            iceServers: [STUN, TURN],
            credentialTtlMs: null,
        })
    })

    it('interroge ENDPOINTS.ICE_SERVERS en GET', async () => {
        // Fige le contrat avec le backend : c'est l'URL nommée dans `routes.public.php`, et le
        // verbe qui évite le 419 → `document.location.reload()` d'`AjaxService`.
        const AjaxService = makeAjax(async () => ({ iceServers: [STUN] }))

        await fetchIceServers(AjaxService)

        expect(AjaxService.load).toHaveBeenCalledWith(ENDPOINTS.ICE_SERVERS, 'get')
    })
})

describe('fetchIceServers — durée de vie du credential', () => {
    it('convertit `credential_ttl` en millisecondes', async () => {
        // Le contrat du contrôleur : la clé est à la RACINE (jamais dans l'entrée TURN, dont les
        // trois clés sont une liste blanche) et porte des SECONDES.
        const AjaxService = makeAjax(async () => ({ iceServers: [STUN, TURN], credential_ttl: 86400 }))

        await expect(fetchIceServers(AjaxService)).resolves.toEqual({
            iceServers: [STUN, TURN],
            credentialTtlMs: 86_400_000,
        })
    })

    it('rend null quand la réponse n\'annonce aucun TTL', async () => {
        // L'invité (aucune entrée TURN) et le mode statique (couple longue durée) : le contrôleur
        // OMET la clé, et c'est ce qui dit « rien à rafraîchir ».
        const AjaxService = makeAjax(async () => ({ iceServers: [STUN, TURN] }))

        const { credentialTtlMs } = await fetchIceServers(AjaxService)

        expect(credentialTtlMs).toBeNull()
    })

    it.each([
        ['chaîne', '86400'],
        ['zéro', 0],
        ['négatif', -60],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['null explicite', null],
    ])('rend null quand le TTL n\'est pas une durée exploitable — %s', async (_label, ttl) => {
        // Aucune de ces valeurs ne vient du contrôleur : elles viennent d'un proxy, d'une couche de
        // sérialisation, ou d'un futur contributeur. Le point n'est pas la propreté : `ttl - marge`
        // sur `NaN` rend `NaN`, et `setTimeout(fn, NaN)` DÉCLENCHE IMMÉDIATEMENT — donc une boucle
        // chaude sur la route, pire que la panne qu'on ferme.
        const AjaxService = makeAjax(async () => ({ iceServers: [TURN], credential_ttl: ttl }))

        const { credentialTtlMs } = await fetchIceServers(AjaxService)

        expect(credentialTtlMs).toBeNull()
    })

    it('ignore le TTL quand les iceServers sont inexploitables', async () => {
        // Une charge utile dont les entrées sont toutes filtrées n'a pas de credential à faire
        // expirer : on rend le repli ENTIER, TTL compris. Sans ça, l'appelant armerait un
        // rafraîchissement pour une configuration STUN qui n'en a aucun besoin.
        const AjaxService = makeAjax(async () => ({ iceServers: [{ urls: '' }], credential_ttl: 3600 }))

        await expect(fetchIceServers(AjaxService)).resolves.toEqual(REPLI)
    })
})

describe('fetchIceServers — replis', () => {
    it('rend STUN seul, sans jeter, quand la requête rejette', async () => {
        const AjaxService = makeAjax(async () => { throw new Error('500') })

        await expect(fetchIceServers(AjaxService)).resolves.toEqual(REPLI)
    })

    it.each([
        ['réponse vide', {}],
        ['réponse nulle', null],
        ['iceServers non tableau', { iceServers: 'oops' }],
        ['forme des doublures de test', { data: {} }],
    ])('rend STUN seul quand la réponse est inexploitable — %s', async (_label, payload) => {
        const AjaxService = makeAjax(async () => payload)

        await expect(fetchIceServers(AjaxService)).resolves.toEqual(REPLI)
    })

    it('filtre les entrées sans urls utilisable, et retombe en STUN si tout est filtré', async () => {
        // Une entrée sans `urls` n'est pas inerte : l'agent ICE la prend pour un serveur à
        // interroger et attend son échec avant de conclure.
        const partiel = makeAjax(async () => ({ iceServers: [{}, { urls: '' }, { urls: [] }, TURN] }))
        await expect(fetchIceServers(partiel)).resolves.toEqual({ iceServers: [TURN], credentialTtlMs: null })

        const total = makeAjax(async () => ({ iceServers: [{}, { urls: '   ' }] }))
        await expect(fetchIceServers(total)).resolves.toEqual(REPLI)
    })

    it('rend STUN seul, sans jeter, quand aucun client HTTP n\'est fourni', async () => {
        await expect(fetchIceServers(undefined)).resolves.toEqual(REPLI)
        await expect(fetchIceServers({})).resolves.toEqual(REPLI)
    })

    it('rend STUN seul quand la requête ne settle jamais (timeout)', async () => {
        // Le cas qui justifie le `Promise.race` : `AjaxService.load` a DEUX chemins qui ne
        // résolvent ni ne rejettent — 401/419 (`reload()`) et 302 (`location.href`). Sans timeout,
        // l'`await` de `_doInit` voudrait dire « plus jamais de Peer dans cet onglet ».
        vi.useFakeTimers()
        const AjaxService = makeAjax(() => new Promise(() => {}))

        const enVol = fetchIceServers(AjaxService)
        await vi.advanceTimersByTimeAsync(ICE_FETCH_TIMEOUT_MS)

        await expect(enVol).resolves.toEqual(REPLI)
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
