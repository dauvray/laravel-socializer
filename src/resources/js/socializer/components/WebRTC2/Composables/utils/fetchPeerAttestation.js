/**
 * fetchPeerAttestation.js — les deux allers-retours de l'attestation d'identité
 *
 * Ce que l'attestation ferme : le chemin (a) de `_isAuthorizedIncomingPeer` (appartenance à la
 * room) admettait un pair sur la seule foi de `metadata.from`, un champ que l'émetteur choisit. Le
 * serveur signe donc `{peerId, slug, exp}` — le slug étant celui d'`Auth::user()`, jamais un champ
 * du corps —, le porteur la transporte dans sa `metadata`, et le récepteur la fait vérifier ici.
 * Détail et bornes : `docs/modules/webrtc2/securite.md`.
 *
 * ── LE CONTRAT DE CE MODULE ───────────────────────────────────────────────────────────────────
 *
 * **Les deux fonctions ne jettent JAMAIS.** C'est ce qui autorise leurs appelants — un callback de
 * `setTimeout` pour l'une, un garde d'admission pour l'autre — à s'en servir sans `try/catch`.
 * Une exception dans un callback de minuteur est une `unhandledRejection` que personne n'observe ;
 * une exception dans le garde entrant refuserait une connexion sans le dire.
 *
 * **Et elles ne concluent jamais à la place de leur appelant.** Chacune a une valeur qui dit « je
 * ne sais pas », distincte de « la réponse est non » :
 *
 *   - `fetchPeerAttestation` rend `attestation: null` sur TOUS les chemins de repli (route morte,
 *     réponse illisible, délai dépassé) **et** quand le serveur annonce le mécanisme inactif. La
 *     règle est donc totale : `null` ⇒ je n'ai rien à présenter.
 *   - `verifyPeerAttestation` rend `{ slug: null, answered: false }` quand le serveur n'a pas
 *     répondu, contre `{ slug: null, answered: true }` quand il a répondu « invalide ». ⚠️ **Cette
 *     distinction est load-bearing** : c'est elle qui sépare le refus (le serveur a tranché) du
 *     *fail-open* (l'infra est muette). Les confondre ferait d'une panne de route une coupure de
 *     visio non rattrapable — une MediaConnection refusée n'est notifiée à personne.
 *
 * ⚠️ `AjaxService` est reçu en PARAMÈTRE, jamais `useAjaxService()` — même raison que
 * `fetchIceServers` : le faux serveur des tests de scénario (`helpers/fakeSignalingServer.js`,
 * `bindLastClientTo`) attribue le dernier client créé au pair courant, et repose sur le fait que
 * `useAjaxService()` n'est appelé QU'UNE FOIS par contexte, dans `createPeerContext`.
 *
 * ⚠️ Aucun cache de module, et c'est délibéré. Une attestation est périssable par construction :
 * un cache la servirait périmée à un onglet longtemps ouvert et rendrait le rafraîchissement
 * lui-même inopérant. La mémoïsation des verdicts existe, mais elle vit dans le STORE (indexée par
 * peerId, avec l'échéance de l'attestation), pas ici — un cache de module se comporte mal au HMR,
 * où deux copies du module coexistent.
 */

import {
    ATTESTATION_FETCH_TIMEOUT_MS,
    ENDPOINTS,
    MAX_ATTESTATION_LENGTH,
} from '../../webrtc2.config.js'

/**
 * Le repli de l'obtention, sous la forme de retour du module.
 *
 * `enforce: false` sur tous les chemins de repli : la politique du serveur ne se devine pas, et
 * une valeur inventée ici ferait refuser des pairs légitimes au nom d'un contrôle dont on n'a même
 * pas pu obtenir la clé.
 *
 * @returns {{ attestation: null, ttlMs: null, enforce: false }}
 */
function noAttestation() {
    return { attestation: null, ttlMs: null, enforce: false }
}

/**
 * La durée de vie annoncée par le serveur, en millisecondes, ou `null`.
 *
 * `attestation_ttl` est ABSENTE de la réponse dès qu'il n'y a rien à rafraîchir (mécanisme
 * inactif) : c'est le contrat du contrôleur. On refuse en plus tout ce qui n'est pas une durée
 * exploitable — chaîne, zéro, négatif, `Infinity`, `NaN` — parce qu'un délai calculé sur `NaN`
 * armerait un `setTimeout` qui déclenche immédiatement.
 *
 * @param {unknown} ttlSeconds
 * @returns {number|null}
 */
function toTtlMs(ttlSeconds) {
    if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        return null
    }

    return ttlSeconds * 1000
}

/**
 * Une attestation reçue est-elle exploitable telle quelle ?
 *
 * Contrôle de FORME seulement — la validité est un fait du serveur, jamais du client. Il évite de
 * transporter dans chaque `metadata` une chaîne que le vérificateur refusera en 422, et de garder
 * pour attestation le `null` que le contrôleur sert quand le mécanisme est inactif.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isUsableAttestation(value) {
    return typeof value === 'string'
        && value !== ''
        && value.length <= MAX_ATTESTATION_LENGTH
}

/**
 * Un aller-retour borné dans le temps, dont le perdant de la course est toujours annulé.
 *
 * `Promise.race` et non un simple `await` : `AjaxService.load` a deux chemins qui ne settlent
 * jamais. Le `clearTimeout` du `finally` est load-bearing et non cosmétique — un timer survivant à
 * une requête réussie rejetterait une promesse que plus personne n'observe, ce que vitest remonte
 * en `unhandledRejection`.
 *
 * @param {{ load: Function }} AjaxService
 * @param {string} endpoint
 * @param {Object} body
 * @param {number} timeoutMs
 * @returns {Promise<Object>}
 */
function postWithTimeout(AjaxService, endpoint, body, timeoutMs) {
    let timer = null

    return Promise.race([
        AjaxService.load(endpoint, 'post', body),
        new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('délai dépassé')), timeoutMs)
        }),
    ]).finally(() => {
        if (timer !== null) { clearTimeout(timer) }
    })
}

/**
 * Fait signer par le serveur le couple (peerId local, identité authentifiée).
 *
 * @param {{ load: Function }} AjaxService  Le client du contexte (`ctx.AjaxService`)
 * @param {string} peerId                   L'identité PeerJS locale, telle que l'`'open'` l'a rendue
 * @param {Object} [options]
 * @param {number} [options.timeoutMs]      Défaut : `ATTESTATION_FETCH_TIMEOUT_MS`
 * @returns {Promise<{ attestation: string|null, ttlMs: number|null, enforce: boolean }>}
 *          `attestation` non nulle UNIQUEMENT si le serveur a répondu et que le mécanisme est actif.
 */
export async function fetchPeerAttestation(AjaxService, peerId, { timeoutMs = ATTESTATION_FETCH_TIMEOUT_MS } = {}) {

    if (!AjaxService || typeof AjaxService.load !== 'function') {
        console.warn('[WebRTC2] Aucun client HTTP pour obtenir une attestation de peerId.')
        return noAttestation()
    }

    // Garde symétrique de celle du contrôleur : sans peerId local il n'y a rien à faire attester,
    // et le POST partirait pour un 422. Le seul appelant est déjà sous l'`'open'`, donc ce chemin
    // n'est atteignable que par un mauvais câblage — il doit le dire, pas l'avaler.
    if (typeof peerId !== 'string' || peerId === '') {
        console.warn('[WebRTC2] Attestation demandée sans peerId local — demande abandonnée.')
        return noAttestation()
    }

    try {
        const payload = await postWithTimeout(
            AjaxService, ENDPOINTS.ATTEST_PEER_ID, { peerId }, timeoutMs
        )

        // Lecture STRICTE de `payload.attestation`, jamais `payload.data.attestation` : le vrai
        // `AjaxService.load` résout déjà `response.data`. Les doublures qui rendent `{data:{}}`
        // produisent une forme que le vrai client ne produit pas ; les lire des deux façons
        // maquillerait cette infidélité au lieu de laisser le repli s'appliquer.
        if (!isUsableAttestation(payload?.attestation)) {
            // Pas un `warn` : c'est aussi la réponse NOMINALE d'un déploiement dont le mécanisme
            // est inactif (aucun secret, aucune `APP_KEY`). Le bruit appartient au garde, qui sait
            // seul si l'absence d'attestation a une conséquence.
            console.debug('[WebRTC2] Aucune attestation de peerId servie — admission non corroborée côté récepteur.')
            return noAttestation()
        }

        return {
            attestation: payload.attestation,
            ttlMs: toTtlMs(payload?.attestation_ttl),
            // La politique est celle du SERVEUR, et elle voyage avec l'attestation. Un booléen
            // strict : une valeur absente ou d'un autre type vaut « ne pas refuser », le seul
            // défaut sûr des deux.
            enforce: payload?.enforce === true,
        }
    } catch (e) {
        console.warn('[WebRTC2] Attestation de peerId indisponible :', e?.message ?? e)
        return noAttestation()
    }
}

/**
 * À qui le serveur reconnaît-il ce peerId, d'après l'attestation présentée ?
 *
 * ⚠️ `answered` n'est pas décoratif — voir le contrat en tête de fichier. `slug: null` avec
 * `answered: true` est un REFUS ; avec `answered: false`, c'est une IGNORANCE, et un garde qui
 * refuserait dessus transformerait une panne de route en coupure de visio non rattrapable.
 *
 * @param {{ load: Function }} AjaxService
 * @param {string} attestation  Ce que le pair distant a mis dans sa `metadata`
 * @param {string} peerId       L'identité PeerJS RÉELLE de la connexion (`conn.peer`)
 * @param {Object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ slug: string|null, answered: boolean }>}
 */
export async function verifyPeerAttestation(AjaxService, attestation, peerId, { timeoutMs = ATTESTATION_FETCH_TIMEOUT_MS } = {}) {

    if (!AjaxService || typeof AjaxService.load !== 'function') {
        console.warn('[WebRTC2] Aucun client HTTP pour vérifier une attestation de peerId.')
        return { slug: null, answered: false }
    }

    // Refusé LOCALEMENT, et compté comme une réponse : une attestation malformée ou absurdement
    // longue est un fait observable ici, pas une ignorance. Payer un aller-retour pour se faire
    // rendre un 422 consommerait en plus un jeton du plafond serveur — à la cadence que
    // choisirait l'attaquant.
    if (!isUsableAttestation(attestation) || typeof peerId !== 'string' || peerId === '') {
        return { slug: null, answered: true }
    }

    try {
        const payload = await postWithTimeout(
            AjaxService, ENDPOINTS.VERIFY_PEER_ATTESTATION, { attestation, peerId }, timeoutMs
        )

        // Le serveur a tranché — `slug` est une chaîne non vide, ou `null`. Toute autre forme est
        // une réponse qu'on ne sait pas lire : `answered: false`, donc traitée comme l'ignorance
        // qu'elle est.
        if (typeof payload?.slug === 'string' && payload.slug !== '') {
            return { slug: payload.slug, answered: true }
        }

        if (payload?.slug === null) {
            return { slug: null, answered: true }
        }

        console.warn('[WebRTC2] Réponse de vérification d\'attestation illisible — verdict indéterminé.')
        return { slug: null, answered: false }
    } catch (e) {
        console.warn('[WebRTC2] Vérification d\'attestation indisponible :', e?.message ?? e)
        return { slug: null, answered: false }
    }
}
