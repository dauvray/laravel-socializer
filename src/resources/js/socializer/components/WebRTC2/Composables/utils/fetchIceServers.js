/**
 * fetchIceServers.js — Configuration ICE (STUN/TURN) récupérée auprès du serveur
 *
 * Les identifiants TURN vivaient dans `import.meta.env.VITE_COTURN_*`, donc **inlinés par Vite
 * dans le bundle** servi à tout visiteur : le mot de passe du conteneur coturn était lisible en
 * ouvrant le JS. Ils sont désormais calculés par `WebRTCController::getIceServers`
 * (`GET /get-ice-servers`, publique, toujours 200 — STUN seul pour un invité, STUN + TURN pour une
 * session authentifiée).
 *
 * ── LE CONTRAT DE CE MODULE, ET LA RAISON D'ÊTRE DE SON ISOLEMENT ──────────────────────────────
 *
 * **Il ne jette JAMAIS et rend TOUJOURS un tableau non vide.** C'est ce qui autorise
 * `usePeerTransport._doInit` à l'`await`er sans `try/catch` dans son chemin critique, et c'est ce
 * qui garantit que le `Peer` est créé quoi qu'il arrive. Une panne de la route dégrade en STUN,
 * elle ne coupe pas WebRTC.
 *
 * ⚠️ Il reçoit `AjaxService` en PARAMÈTRE, il n'appelle jamais `useAjaxService()` lui-même. Le
 * faux serveur de signalisation des tests de scénario (`helpers/fakeSignalingServer.js`,
 * `bindLastClientTo`) attribue le dernier client créé au pair courant : il repose sur le fait que
 * `useAjaxService()` n'est appelé QU'UNE FOIS par contexte, dans `createPeerContext`. Un second
 * appel volerait le client au pair suivant et casserait le routage des signaux.
 *
 * ⚠️ Aucun cache module-level, et c'est délibéré. Le niveau 2 du chantier TURN servira des
 * credentials HMAC à TTL court : un cache les ferait expirer en silence sur un onglet longtemps
 * ouvert qui recrée son Peer. Et un cache de module se comporte mal au HMR, où deux copies du
 * module coexistent (cf. `usePeerTransport.singleton.test.js`, section HMR). Le coût réel est
 * d'une requête par cycle de vie de Peer, pas par contexte.
 *
 * ⚠️ Deux tests (`singleton.test.js`, destruction différée) appellent `setLocalPeer` avec
 * `vi.useFakeTimers()` DÉJÀ actif et laissent `_doInit` tourner pour de bon. Ils ne restent verts
 * que parce que le mock `AjaxService.load` résout par microtâche. Remplacer ce mock par une
 * implémentation à base de `setTimeout` les figerait.
 */

import { ENDPOINTS, ICE_FETCH_TIMEOUT_MS, STUN_ONLY_ICE_SERVERS } from '../../webrtc2.config.js'

/**
 * Une entrée `iceServers` est-elle exploitable par `RTCPeerConnection` ?
 *
 * Seul `urls` est obligatoire (`username`/`credential` n'existent que pour TURN). Une entrée sans
 * `urls` utilisable n'est pas inerte : l'agent ICE la prend pour un serveur à interroger et
 * attend son échec avant de conclure.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isUsableEntry(entry) {
    if (!entry || typeof entry !== 'object') { return false }

    const { urls } = entry

    if (typeof urls === 'string') { return urls.trim() !== '' }

    if (Array.isArray(urls)) {
        return urls.some((url) => typeof url === 'string' && url.trim() !== '')
    }

    return false
}

/**
 * Récupère la configuration ICE auprès du serveur.
 *
 * @param {{ load: Function }} AjaxService  Le client du contexte (`ctx.AjaxService`)
 * @param {Object}   [options]
 * @param {number}   [options.timeoutMs]    Défaut : `ICE_FETCH_TIMEOUT_MS`
 * @returns {Promise<Array<Object>>}        Toujours un tableau non vide
 */
export async function fetchIceServers(AjaxService, { timeoutMs = ICE_FETCH_TIMEOUT_MS } = {}) {

    if (!AjaxService || typeof AjaxService.load !== 'function') {
        console.warn('[WebRTC2] Aucun client HTTP pour récupérer la configuration ICE — repli sur STUN seul.')
        return STUN_ONLY_ICE_SERVERS
    }

    let timer = null

    try {
        // `Promise.race` et non un simple `await` : cf. l'avertissement en tête de fichier sur les
        // deux chemins d'`AjaxService.load` qui ne settlent jamais. Le perdant de la race doit
        // être annulé — un timer survivant à une récupération réussie rejetterait une promesse que
        // plus personne n'observe, ce que vitest remonte en `unhandledRejection`. D'où le
        // `clearTimeout` du `finally`, qui est load-bearing et non cosmétique.
        const payload = await Promise.race([
            AjaxService.load(ENDPOINTS.ICE_SERVERS, 'get'),
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('délai dépassé')), timeoutMs)
            }),
        ])

        // Lecture STRICTE de `payload.iceServers`, jamais `payload.data.iceServers` : le vrai
        // `AjaxService.load` résout déjà `response.data`. Les doublures de test rendent `{data:{}}`
        // — une forme que le vrai client ne produit pas ; les lire des deux façons maquillerait
        // cette infidélité au lieu de laisser le repli s'appliquer.
        const usable = Array.isArray(payload?.iceServers)
            ? payload.iceServers.filter(isUsableEntry)
            : []

        if (usable.length === 0) {
            console.warn('[WebRTC2] Configuration ICE illisible ou vide — repli sur STUN seul.')
            return STUN_ONLY_ICE_SERVERS
        }

        return usable
    } catch (e) {
        console.warn('[WebRTC2] Configuration ICE indisponible — repli sur STUN seul :', e?.message ?? e)
        return STUN_ONLY_ICE_SERVERS
    } finally {
        if (timer !== null) { clearTimeout(timer) }
    }
}
