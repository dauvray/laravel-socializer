/**
 * fetchPeerAttestation.test.js
 *
 * Le contrat du module tient en deux phrases, et ce fichier vérifie les deux.
 *
 * 1. **Aucune des deux fonctions ne jette.** C'est ce qui autorise `_doInit` à `await`er l'obtention
 *    sans `try/catch` avant `new Peer`, le callback de `_armAttestationRefresh` à s'en servir sans
 *    filet, et le garde d'admission à interroger le serveur sans qu'une panne réseau devienne un
 *    refus muet.
 * 2. **Elles ne concluent jamais à la place de leur appelant.** Chacune a une valeur qui dit « je ne
 *    sais pas », distincte de « la réponse est non » — `attestation: null` pour l'une, et surtout
 *    `answered: false` pour l'autre.
 *
 * ⚠️ **`answered` est le fait load-bearing de ce fichier**, et il ne ressemble à rien de ce que
 * `fetchIceServers` porte. Il sépare le REFUS (le serveur a tranché : cette attestation ne vaut
 * rien) de l'IGNORANCE (le serveur n'a pas répondu). Les confondre ferait, sous `enforce`, d'une
 * panne de route une coupure de visio non rattrapable — et offrirait le levier correspondant :
 * rendre `/verify-peer-attestation` injoignable suffirait à fermer toutes les rooms.
 *
 * Contrôles de harnais (convention du paquet), mesurés le 2026-08-29 :
 *   - faire rendre `answered: true` au `catch` de `verifyPeerAttestation` rougit **2 cas** — le
 *     fail-open, exactement. ⚠️ Deux et non trois : le cas « aucun client HTTP » sort AVANT le
 *     `try`, et c'est bien ce qu'on veut voir — la garde d'entrée et le `catch` sont deux chemins
 *     distincts vers la même valeur, et un seul de ces contrôles les couvrirait tous les deux si
 *     la fonction n'avait qu'une sortie ;
 *   - retirer le contrôle de forme local (`isUsableAttestation`) rougit **1 cas**, celui qui
 *     assure qu'un refus local ne coûte aucun aller-retour ;
 *   - retirer `enforce: false` du repli rougit **5 cas** — tous ceux qui passent par `noAttestation()`.
 *     La collatéralité est le signe que la politique n'est PAS recopiée chemin par chemin mais tenue
 *     en un seul endroit : c'est précisément ce qui empêche un repli d'en oublier un.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    fetchPeerAttestation,
    verifyPeerAttestation,
} from '~socializer/components/WebRTC2/Composables/utils/fetchPeerAttestation.js'
import {
    ATTESTATION_FETCH_TIMEOUT_MS,
    ENDPOINTS,
    MAX_ATTESTATION_LENGTH,
} from '~socializer/components/WebRTC2/webrtc2.config.js'

const PEER_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const ATTESTATION = 'charge.signature'

/** Client minimal, façonné comme `ctx.AjaxService` (`createMockContext`). */
function makeAjax(load) {
    return { load: vi.fn(load) }
}

/** Le repli de l'obtention, sous la forme de retour du module. */
const RIEN = { attestation: null, ttlMs: null, enforce: false }

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('fetchPeerAttestation — obtention', () => {
    it('rend l\'attestation, sa durée de vie en ms, et la politique du serveur', async () => {
        const AjaxService = makeAjax(async () => ({
            attestation: ATTESTATION,
            attestation_ttl: 300,
            enforce: true,
        }))

        await expect(fetchPeerAttestation(AjaxService, PEER_ID)).resolves.toEqual({
            attestation: ATTESTATION,
            ttlMs: 300_000,
            enforce: true,
        })
    })

    it('POSTe ENDPOINTS.ATTEST_PEER_ID avec le seul peerId', async () => {
        // Fige le contrat avec le backend : c'est l'URL nommée dans `routes.private.php`, et le
        // corps que `WebRTCController::attestPeerId` valide. ⚠️ Le slug n'y est PAS, et ne doit
        // jamais y être : il est lu d'`Auth::user()` côté serveur, et c'est tout le mécanisme.
        const AjaxService = makeAjax(async () => ({ attestation: ATTESTATION, attestation_ttl: 300 }))

        await fetchPeerAttestation(AjaxService, PEER_ID)

        expect(AjaxService.load).toHaveBeenCalledWith(ENDPOINTS.ATTEST_PEER_ID, 'post', { peerId: PEER_ID })
    })

    it('rend le repli quand le serveur n\'annonce aucune attestation (mécanisme inactif)', async () => {
        // Le chemin NOMINAL d'un déploiement sans secret ni `APP_KEY` : ce n'est pas une panne, et
        // rien ne doit être armé. L'admission d'en face retombe sur ce qu'elle faisait avant.
        const AjaxService = makeAjax(async () => ({ attestation: null, enforce: false }))

        await expect(fetchPeerAttestation(AjaxService, PEER_ID)).resolves.toEqual(RIEN)
    })

    it('n\'invente jamais la politique du serveur sur un chemin de repli', async () => {
        // Servir `enforce: true` sans attestation à présenter ferait refuser des pairs légitimes au
        // nom d'un contrôle dont on n'a même pas pu obtenir la clé. Le backend pose déjà la même
        // règle de son côté ; celle-ci est le versant client, et les deux sont nécessaires.
        const AjaxService = makeAjax(async () => { throw new Error('503') })

        await expect(fetchPeerAttestation(AjaxService, PEER_ID)).resolves.toEqual(RIEN)
    })

    it('ne jette pas quand la route est morte, ni quand la réponse est illisible', async () => {
        for (const load of [
            async () => { throw new Error('500') },
            async () => undefined,
            async () => ({}),
            async () => ({ attestation: 42 }),
            async () => ({ attestation: '' }),
            // Plus longue que ce que le vérificateur acceptera : la garder ferait transporter dans
            // chaque `metadata` une chaîne qui repartira en 422.
            async () => ({ attestation: 'a'.repeat(MAX_ATTESTATION_LENGTH + 1) }),
        ]) {
            await expect(fetchPeerAttestation(makeAjax(load), PEER_ID)).resolves.toEqual(RIEN)
        }
    })

    it('rend `ttlMs: null` sur tout TTL inexploitable, sans perdre l\'attestation', async () => {
        // `null` ⇒ rien à rafraîchir : c'est le seul prédicat qu'écrit `_scheduleAttestationRefresh`.
        // Un délai calculé sur `NaN` armerait un `setTimeout` qui déclenche immédiatement, donc une
        // boucle chaude sur une route privée et plafonnée.
        for (const attestation_ttl of [undefined, null, 0, -300, '300', Infinity, NaN]) {
            await expect(
                fetchPeerAttestation(makeAjax(async () => ({ attestation: ATTESTATION, attestation_ttl })), PEER_ID)
            ).resolves.toEqual({ attestation: ATTESTATION, ttlMs: null, enforce: false })
        }
    })

    it('abandonne au bout de ATTESTATION_FETCH_TIMEOUT_MS, sans laisser de minuteur pendant', async () => {
        vi.useFakeTimers()

        const AjaxService = makeAjax(() => new Promise(() => {}))
        const promesse = fetchPeerAttestation(AjaxService, PEER_ID)

        await vi.advanceTimersByTimeAsync(ATTESTATION_FETCH_TIMEOUT_MS)

        await expect(promesse).resolves.toEqual(RIEN)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('n\'interroge rien sans client HTTP ni sans peerId', async () => {
        await expect(fetchPeerAttestation(null, PEER_ID)).resolves.toEqual(RIEN)
        await expect(fetchPeerAttestation({}, PEER_ID)).resolves.toEqual(RIEN)

        const AjaxService = makeAjax(async () => ({ attestation: ATTESTATION }))
        await expect(fetchPeerAttestation(AjaxService, '')).resolves.toEqual(RIEN)
        await expect(fetchPeerAttestation(AjaxService, null)).resolves.toEqual(RIEN)
        expect(AjaxService.load).not.toHaveBeenCalled()
    })
})

describe('verifyPeerAttestation — vérification', () => {
    it('rend le slug nommé par le serveur, et le compte comme une réponse', async () => {
        const AjaxService = makeAjax(async () => ({ slug: 'alice' }))

        await expect(verifyPeerAttestation(AjaxService, ATTESTATION, PEER_ID)).resolves.toEqual({
            slug: 'alice',
            answered: true,
        })
    })

    it('POSTe ENDPOINTS.VERIFY_PEER_ATTESTATION avec l\'attestation ET le peerId réel', async () => {
        // Les DEUX, et c'est leur confrontation qui fait tout le travail : sans le peerId, une
        // attestation valable pour un pair suffirait à en admettre un autre.
        const AjaxService = makeAjax(async () => ({ slug: 'alice' }))

        await verifyPeerAttestation(AjaxService, ATTESTATION, PEER_ID)

        expect(AjaxService.load).toHaveBeenCalledWith(
            ENDPOINTS.VERIFY_PEER_ATTESTATION, 'post', { attestation: ATTESTATION, peerId: PEER_ID },
        )
    })

    it('rend un REFUS tranché quand le serveur répond `slug: null`', async () => {
        // `answered: true` : le serveur a vu l'attestation et l'a rejetée (forgée, expirée, ou pour
        // un autre peerId). C'est ce verdict-là qui fait refuser sous `enforce`.
        await expect(
            verifyPeerAttestation(makeAjax(async () => ({ slug: null })), ATTESTATION, PEER_ID)
        ).resolves.toEqual({ slug: null, answered: true })
    })

    it('refuse LOCALEMENT une attestation absente ou malformée, sans aller-retour', async () => {
        // ⚠️ `answered: true` — c'est un fait observable ici, pas une ignorance. Et surtout : payer
        // un aller-retour pour se faire rendre un 422 consommerait un jeton du plafond serveur, à
        // la cadence que choisirait l'attaquant.
        const AjaxService = makeAjax(async () => ({ slug: 'alice' }))

        for (const attestation of [undefined, null, '', 42, 'a'.repeat(MAX_ATTESTATION_LENGTH + 1)]) {
            await expect(verifyPeerAttestation(AjaxService, attestation, PEER_ID)).resolves.toEqual({
                slug: null,
                answered: true,
            })
        }

        expect(AjaxService.load).not.toHaveBeenCalled()
    })

    it('rend une IGNORANCE — jamais un refus — quand le serveur ne répond pas', async () => {
        // ⚠️ LE CAS QUI COMPTE. `answered: false` est ce qui fait fail-open le garde d'admission,
        // même sous `enforce`. Le rendre `true` ici ferait d'un incident d'infra une coupure de
        // visio non rattrapable, et donnerait à qui sait rendre la route injoignable de quoi fermer
        // toutes les rooms.
        for (const load of [
            async () => { throw new Error('503') },
            async () => undefined,
            async () => ({}),
            async () => ({ slug: 42 }),
        ]) {
            await expect(verifyPeerAttestation(makeAjax(load), ATTESTATION, PEER_ID)).resolves.toEqual({
                slug: null,
                answered: false,
            })
        }

        await expect(verifyPeerAttestation(null, ATTESTATION, PEER_ID)).resolves.toEqual({
            slug: null,
            answered: false,
        })
    })

    it('traite un délai dépassé comme une ignorance, et ne laisse aucun minuteur pendant', async () => {
        vi.useFakeTimers()

        const promesse = verifyPeerAttestation(makeAjax(() => new Promise(() => {})), ATTESTATION, PEER_ID)

        await vi.advanceTimersByTimeAsync(ATTESTATION_FETCH_TIMEOUT_MS)

        await expect(promesse).resolves.toEqual({ slug: null, answered: false })
        // Le perdant de la `Promise.race` doit être annulé : un timer survivant rejetterait une
        // promesse que plus personne n'observe, ce que vitest remonte en `unhandledRejection`.
        expect(vi.getTimerCount()).toBe(0)
    })
})
