/**
 * fakeSignalingServer.js — Le backend de signalisation, en mémoire
 *
 * En production, deux pairs ne se découvrent JAMAIS tout seuls : PeerJS ne sait pas
 * qui est « alice ». C'est le backend Laravel qui traduit un POST en event Reverb, que
 * `components/System/Notifications.vue` transforme en `dispatchSignal`, que
 * `useSignalingQueue` route enfin vers un handler.
 *
 * Tant que ce chaînon manque, aucun test ne peut exercer l'établissement réel d'une
 * connexion — et c'est précisément là que vivent les bugs (« A diffuse, B arrive, B ne
 * voit rien »). Ce module rejoue ce trajet intégralement, en mémoire.
 *
 * ── Le trajet reproduit ───────────────────────────────────────────────────────
 *
 *   A: POST /ask-to-peer-id { toUserSlug: 'bob', room, type }
 *        └─► B reçoit  PEER_CONNECTION_REQUEST     { fromUserSlug: 'alice', room, type }
 *   B: POST /response-to-peer-id { peerId: <B>, toUserSlug: 'alice', room, type }
 *        └─► A reçoit  PEER_CONNECT_TO_REMOTE_PEER { fromUserSlug: 'bob', peerId: <B>, … }
 *              └─► connectToPeer() ouvre enfin la connexion PeerJS
 *
 * Les enveloppes sont copiées sur `Notifications.vue` (`roomId: '<type>-<room>'`, qui
 * est le `contextId` du destinataire) : un scénario qui passe ici emprunte exactement
 * le chemin de production.
 *
 * ── Le second canal : l'invitation d'appel direct ─────────────────────────────
 *
 *   A: POST /send-alert-to-user { toUserSlug: 'bob', options: { peerId: <A>, … } }
 *        └─► B reçoit  .AlertToUser  → composant d'alerte → acceptCallFromPeer()
 *   B: POST /response-to-authorization-peer { options: { peerId: <B>, … }, status }
 *        └─► A reçoit  .ResponseToAuthorizationPeer → openCallBetweenPeer()
 *              └─► requestOrConnectPeer() ouvre la connexion PeerJS
 *
 * Ces deux events ne passent PAS par la file de signaux du store : ils arrivent sur le
 * canal utilisateur, que `Notifications.vue` écoute. Le harnais les livre à un handler
 * branché par `bindUserChannel(slug, handler)` — c'est au test de tenir le rôle de ce
 * composant, décision humaine du composant d'alerte comprise.
 *
 * ── Branchement dans un fichier de test ───────────────────────────────────────
 *
 * `useAjaxService()` n'est appelé qu'une fois, dans `createPeerContext`. On le mocke
 * pour que chaque contexte reçoive un client relié à ce serveur. La factory doit être
 * inline (`vi.mock` est hoisté : une référence importée serait en TDZ) :
 *
 *     vi.mock('~estarter/services/AjaxService.js', () => ({
 *         useAjaxService: () => globalThis[Symbol.for('webrtc2.test.signalingServer')]
 *             .createClient(),
 *     }))
 *
 * puis, dans le test : `const server = createFakeSignalingServer()`.
 */
import { vi } from 'vitest'
import { ENDPOINTS } from '~socializer/components/WebRTC2/webrtc2.config.js'

// Partagé par toutes les copies du module (le harnais appelle vi.resetModules()).
export const SIGNALING_SERVER_KEY = Symbol.for('webrtc2.test.signalingServer')

const _getServer = () => globalThis[SIGNALING_SERVER_KEY] ?? null

export function createFakeSignalingServer() {
    /** slug → { peerStore, contextId } */
    const peers = new Map()
    /** client AjaxService → slug (lié par createVirtualPeer après le montage) */
    const clientOwners = new Map()
    /** slug → (eventName, payload) => void — le rôle de `System/Notifications.vue` */
    const userChannels = new Map()
    /** Slugs devenus injoignables (onglet fermé) : leurs signaux sont abandonnés. */
    const unreachable = new Set()
    /** Journal de tous les POST, pour assertions et diagnostic. */
    const requests = []

    let lastClient = null

    /**
     * La politique servie avec chaque attestation — `config('socializer.signaling.attestation.enforce')`.
     *
     * ⚠️ FAUX par défaut, comme la config livrée et comme un déploiement qui n'a pas encore
     * basculé : les scénarios existants n'ont pas à connaître ce mécanisme. Un test qui veut
     * exercer le refus le DEMANDE (`server.setAttestationEnforce(true)`).
     */
    let attestationEnforce = false

    /**
     * Achemine un signal serveur vers un pair, dans l'enveloppe exacte de
     * Notifications.vue. `roomId` est le contextId du DESTINATAIRE.
     */
    const _dispatchTo = (toSlug, { room, type, signalType, payload }) => {
        if (unreachable.has(toSlug)) return false

        const target = peers.get(toSlug)
        if (!target) return false

        // ⚠️ Une tâche de boucle d'événement par signal — jamais deux dans le même tick.
        //
        // `useSignalingQueue` ne consomme que le DERNIER signal de la room
        // (`ctx.lastRoomSignal`, sémantique at(-1)) : deux `dispatchSignal` avant le
        // flush du watcher et le premier est perdu. C'est le « signal coalescé » que la
        // TODOLIST instrumente, et dont elle établit qu'aucun chemin de production ne le
        // produit — précisément parce qu'un event Reverb = une frame WebSocket = une
        // tâche, et que les microtâches (donc le flush du watch) sont drainées entre
        // deux tâches.
        //
        // Un dispatch synchrone ici casserait cet invariant : le harnais fabriquerait
        // une coalescence impossible en production, et des scénarios échoueraient sur un
        // artefact de test. `setTimeout(…, 0)` reproduit la granularité réelle.
        setTimeout(() => {
            target.peerStore.dispatchSignal({
                emitter: 'FakeSignalingServer',
                roomId: `${type}-${room}`,
                type: signalType,
                payload,
            })
        }, 0)
        return true
    }

    /**
     * Achemine un event du canal utilisateur Reverb (`App.Models.User.<id>`).
     *
     * ⚠️ Ce canal n'est PAS la file de signaux du store : `Notifications.vue` route les
     * invitations d'appel vers `acceptCallFromPeer` / `openCallBetweenPeer`, et
     * `.AlertToUser` passe même par une décision humaine (le composant d'alerte). Le
     * harnais s'arrête donc au bord du composant : il livre l'event, c'est au test de
     * jouer le rôle que `Notifications.vue` tient en production — sans quoi il faudrait
     * monter le composant, et le scénario ne parlerait plus de WebRTC.
     *
     * Même granularité que `_dispatchTo` : une tâche de boucle d'événement par event.
     */
    const _broadcastToUser = (toSlug, eventName, payload) => {
        if (unreachable.has(toSlug)) return false

        const handler = userChannels.get(toSlug)
        if (!handler) return false

        setTimeout(() => handler(eventName, payload), 0)
        return true
    }

    const _handlePost = (client, url, method, data = {}) => {
        const fromUserSlug = clientOwners.get(client) ?? null
        requests.push({ from: fromUserSlug, url, method, data })

        // Un pair injoignable n'émet plus rien non plus (onglet fermé).
        if (fromUserSlug && unreachable.has(fromUserSlug)) return

        const { toUserSlug, room, type, connectionType, peerId } = data

        // Le backend caste : absent ou null arrive `false` chez le destinataire, jamais
        // `undefined` (cf. `UserController::broadcastingRules`). Le reproduire ici, sinon
        // un test pourrait passer sur un `undefined` qui n'existe pas en production.
        const isBroadcasting = data.isBroadcasting === true

        // ⚠️ Les payloads reproduisent la liste blanche exacte de `UserController` :
        // le backend ne relaie QUE les champs qu'il nomme. Ajouter ici un champ que le
        // PHP ne transmet pas rendrait des scénarios verts sur un chemin impossible en
        // production — la classe de faux positif qui a déjà piégé ce package deux fois.
        // `type` route le signal (roomId = '<type>-<room>'), `connectionType` porte la
        // connexion à ouvrir, `isBroadcasting` l'état de diffusion de l'émetteur.
        switch (url) {
            case ENDPOINTS.ASK_TO_PEER_ID:
                _dispatchTo(toUserSlug, {
                    room,
                    type,
                    signalType: 'PEER_CONNECTION_REQUEST',
                    payload: { fromUserSlug, room, type, connectionType, isBroadcasting },
                })
                break

            case ENDPOINTS.RESPONSE_TO_PEER_ID:
                _dispatchTo(toUserSlug, {
                    room,
                    type,
                    signalType: 'PEER_CONNECT_TO_REMOTE_PEER',
                    // `connectToPeer` lit `userSlug || fromUserSlug` : on envoie
                    // `fromUserSlug`, comme le backend réel.
                    payload: { fromUserSlug, peerId, room, type, connectionType, isBroadcasting },
                })
                break

            // Invitation d'appel direct : `UserController::sendAlertToUser` ne relaie que
            // `options` (verbatim) et le `fromUserSlug` AUTHENTIFIÉ — pas de `status`,
            // pas de room, pas de type au premier niveau.
            case ENDPOINTS.SEND_ALERT_TO_USER:
                _broadcastToUser(toUserSlug, 'AlertToUser', {
                    options: data.options,
                    fromUserSlug,
                })
                break

            // Réponse à l'invitation : `UserController::responseToPeerAuthorization`
            // relaie `options` et `status`. C'est `sendAuthorizationRemotePeerId` qui a
            // déjà écrasé `options.peerId` par le peerId LOCAL du répondeur — le backend
            // ne le fabrique pas.
            case ENDPOINTS.RESPONSE_TO_AUTHORIZATION_PEER:
                _broadcastToUser(toUserSlug, 'ResponseToAuthorizationPeer', {
                    options: data.options,
                    status: data.status,
                    fromUserSlug,
                })
                break

            // ── Attestation d'identité ────────────────────────────────────────────────
            //
            // Ces deux routes ne RELAIENT rien : elles répondent. `_handlePost` rend donc ici
            // une charge utile, là où tout le reste rend le `{ data: {} }` par défaut.
            //
            // ⚠️ **LA PROPRIÉTÉ REPRODUITE EST LA SEULE QUI COMPTE : le slug attesté vient du
            // CLIENT AUTHENTIFIÉ, jamais du corps.** C'est `clientOwners.get(client)`, exactement
            // comme `Auth::user()->slug` côté PHP. Un pair virtuel ne peut donc pas se faire
            // délivrer une attestation au nom d'un autre — et c'est ce qui rend le scénario
            // d'usurpation honnête plutôt que scripté.
            //
            // La « signature » est un simple `peerId::slug` : le harnais n'a pas à reproduire
            // HMAC-SHA256, il a à reproduire l'INFALSIFIABILITÉ, qui vient d'ici et non de
            // l'algorithme. Ce que le harnais ne prouvera donc jamais — que la charge signée
            // résiste à la forge — est prouvé côté PHP par `PeerAttestationTest`.
            case ENDPOINTS.ATTEST_PEER_ID:
                if (!fromUserSlug || !peerId) return { attestation: null, enforce: attestationEnforce }

                return {
                    attestation: `${peerId}::${fromUserSlug}`,
                    attestation_ttl: 300,
                    enforce: attestationEnforce,
                }

            case ENDPOINTS.VERIFY_PEER_ATTESTATION: {
                const [signedPeerId, signedSlug] = String(data.attestation ?? '').split('::')

                // La confrontation avec le peerId RÉEL de la connexion : sans elle, l'attestation
                // d'un pair suffirait à en admettre un autre.
                return { slug: (signedPeerId && signedPeerId === data.peerId) ? (signedSlug ?? null) : null }
            }

            // `/close-connection-to-peer-id` reste journalisé mais non routé : aucun
            // scénario ne vise encore `.CloseConnectionToPeerID`.
            default:
                break
        }
    }

    const server = {
        /**
         * Fabrique le client injecté à un contexte. Appelé par le mock de
         * `useAjaxService` ; `createVirtualPeer` l'associe ensuite à un slug.
         */
        createClient() {
            const client = {
                load: vi.fn(async (url, method = 'get', data = {}) => {
                    // ⚠️ La charge utile rendue par `_handlePost` l'emporte, quand il en rend une.
                    // Les cinq routes de signalisation RELAIENT (elles ne répondent rien d'utile)
                    // et gardent donc le `{ data: {} }` historique ; les deux routes d'attestation
                    // RÉPONDENT, et leur réponse EST le mécanisme.
                    return _handlePost(client, url, method, data) ?? { data: {} }
                }),
            }
            lastClient = client
            return client
        },

        /**
         * Bascule la politique `enforce` servie avec les attestations.
         *
         * C'est le geste que le déployeur fait dans son `.env` une fois que la trace
         * « Admission entrante non corroborée » a disparu du cas nominal.
         */
        setAttestationEnforce(value) {
            attestationEnforce = value === true
        },

        /**
         * Associe le dernier client créé au pair qui vient d'être monté.
         * Fiable parce que `useAjaxService()` n'est appelé qu'une fois par contexte
         * (`createPeerContext.js:56`) et que le harnais monte les pairs un par un.
         */
        bindLastClientTo(slug) {
            if (lastClient) clientOwners.set(lastClient, slug)
            lastClient = null
        },

        registerPeer(slug, { peerStore, contextId }) {
            peers.set(slug, { peerStore, contextId })
        },

        /**
         * Branche le canal utilisateur Reverb d'un pair — un seul par slug, comme le
         * `useReverbChannel(userChannel)` unique de `Notifications.vue`.
         *
         * @param {string}   slug
         * @param {Function} handler  (eventName, payload) => void
         */
        bindUserChannel(slug, handler) {
            userChannels.set(slug, handler)
        },

        /**
         * Simule un onglet fermé : le pair n'émet plus et ne reçoit plus rien.
         * Le reste du système ne l'apprend que par la fermeture de ses connexions —
         * exactement le cas « coupure brutale, sans signal serveur ».
         */
        goOffline(slug) { unreachable.add(slug) },
        goOnline(slug) { unreachable.delete(slug) },

        /** POST reçus, filtrables par endpoint — utile pour assertions et diagnostic. */
        requests,
        requestsTo(url) { return requests.filter((r) => r.url === url) },

        destroy() {
            peers.clear()
            clientOwners.clear()
            userChannels.clear()
            unreachable.clear()
            requests.length = 0
            if (globalThis[SIGNALING_SERVER_KEY] === server) {
                delete globalThis[SIGNALING_SERVER_KEY]
            }
        },
    }

    globalThis[SIGNALING_SERVER_KEY] = server
    return server
}

/** Retire le serveur s'il existe (sûr à appeler sans serveur actif). */
export function resetFakeSignalingServer() {
    _getServer()?.destroy()
    delete globalThis[SIGNALING_SERVER_KEY]
}
