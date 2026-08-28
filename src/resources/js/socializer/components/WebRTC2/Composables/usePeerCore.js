/**
 * 🧠 usePeerCore (Signaling Layer)
 * 
 *  gestion des identités, autorisations, peerId exchange (tout ce qui passe par HTTP/Ajax + store sans ouvrir de connexion)
 *
 * 👉 gère :
 * - échanges de peerId (ask / response)
 * - autorisations de connexion
 * - communication avec le backend (Ajax)
 *
 * 👉 ne gère PAS :
 * - connexions WebRTC (peer.connect / peer.call)
 * - MediaStream
 *
 * 👉 rôle :
 * - agir comme serveur de signalisation côté client
 * - préparer les informations nécessaires aux connexions 
 */
import { onUnmounted } from 'vue'
import { usePeerRetry } from '~socializer/components/WebRTC2/Composables/utils/usePeerRetry.js'
import { createRateLimiter } from '~socializer/components/WebRTC2/Composables/utils/createRateLimiter.js'
import { isAuthorizedPeer } from '~socializer/components/WebRTC2/Composables/utils/isAuthorizedPeer.js'
import {
    ASK_PEER_MAX_REQUESTS_PER_WINDOW,
    ASK_PEER_RATE_WINDOW_MS,
    ENDPOINTS,
    MAX_INVITE_RETRIES,
    SIGNALING_STALE_MS,
} from '~socializer/components/WebRTC2/webrtc2.config.js'

// ─── Rate limiting client sur /ask-to-peer-id ────────────────────────────────
// Au niveau **module**, et non dans la closure de usePeerCore(ctx) : c'est ce qui
// le fait survivre à un mount/unmount rapide, l'un des deux scénarios de spam visés
// (l'autre étant la boucle de recovery peer-unavailable). Une instance par contexte
// serait recréée à chaque montage et ne plafonnerait donc rien.
const _askPeerRateLimiter = createRateLimiter({
    windowMs: ASK_PEER_RATE_WINDOW_MS,
    max: ASK_PEER_MAX_REQUESTS_PER_WINDOW,
})

export function usePeerCore(ctx) {

    /*------  Retry invitation pour calls ----------*/

    // Moteur de retry dédié aux invitations (séparé du retryManager connexions de l'orchestrateur)
    const inviteRetryManager = usePeerRetry(ctx, {
        /**
         * Tentatives épuisées = le destinataire n'a jamais répondu, et n'a très
         * probablement aucun onglet ouvert : aucun `.ResponseToAuthorizationPeer` ne
         * partira jamais, donc rien d'autre ne viendra sortir l'appelant de `calling`.
         *
         * Cette couche ne connaît ni la FSM d'appel ni l'UI — elle pose un signal sur le
         * contexte (comme `peerUnavailableSignal`) et laisse `Notifications.vue` rejouer
         * le chemin du refus. Un callback vers `stopCallWithPeers` serait un callback vers
         * une couche supérieure, ce que l'ordre des couches interdit.
         *
         * @param {string} userSlug - Destinataire dont l'invitation est abandonnée.
         */
        onAbandoned: (userSlug) => {
            // `usePeerRetry` n'a effacé que son minuteur : l'entrée slug → inviteId, elle,
            // n'est connue que d'ici.
            stopCallInviteRetryForUser(userSlug)

            ctx.inviteAbandonedSignal.value = {
                userSlug,
                type: ctx.session.currentType,
            }
        },
    })

    // Mapping userSlug → inviteId (pour annulation par inviteId)
    const userSlugToInviteId = new Map()

    const buildInviteId = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID()
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }

    const stopCallInviteRetry = (inviteId) => {
        if (!inviteId) return
        for (const [userSlug, id] of userSlugToInviteId.entries()) {
            if (id === inviteId) {
                stopCallInviteRetryForUser(userSlug)
                return
            }
        }
    }

    const stopCallInviteRetryForUser = (userSlug) => {
        if (!userSlug) return
        inviteRetryManager.clearRetry(userSlug)
        userSlugToInviteId.delete(userSlug)
    }

    const clearAllCallInviteRetries = () => {
        inviteRetryManager.clearAll()
        userSlugToInviteId.clear()
    }

    /*------  Connection directe ----------*/

    /**
     * Demande à un peer distant son peerId pour pouvoir ensuite ouvrir une connexion WebRTC.
     *
     * ⚠️ Deux types voyagent, et il ne faut surtout pas les confondre :
     *
     * - `type` = type du **contexte** (`ctx.session.currentType`). C'est la **clé de
     *   routage** du signal : `Notifications.vue` en dérive `roomId = '<type>-<room>'`,
     *   qui doit être le `contextId` du destinataire. Y mettre `'screen'` enverrait la
     *   réponse dans une file que **personne n'observe** — le signal serait perdu.
     * - `connectionType` = type de connexion réellement demandé (`'screen'`…).
     *
     * Historiquement seul `type` était envoyé, donc la signalisation n'ouvrait **jamais**
     * la connexion d'écran vers un arrivant : seul `_handleConnectionAttempt` le faisait,
     * via son moteur de retry. Le partage d'écran reposait donc entièrement sur le retry
     * (≈1,5 s de latence au mieux), ce qui l'a rendu fragile deux fois — un `return`
     * prématuré dans la chaîne de retry le coupait totalement.
     *
     * @param {string}      userSlug
     * @param {string|null} connectionType  Type de connexion visé ; défaut = type du contexte
     * @returns {Promise<boolean>}
     */
    const requestRemotePeerConnection = async (userSlug, connectionType = null) => {

        const room = ctx.session.onAirRoom
        const type = ctx.session.currentType
        const requestedType = connectionType || type
        const localPeerId = ctx.peerStore.getLocalPeerId

        if (!localPeerId) {
            console.warn('localPeer pas encore prêt')
            return false
        }

        // Le garde anti-spam porte sur MA demande — celle de ce contexte pour ce type.
        // La discrimination est désormais dans la clé du store (slug|room|type) et non
        // dans une comparaison de champs ici : une demande émise par un autre contexte
        // n'est plus visible, donc ne peut plus étrangler celle-ci (ni la 'screen' par
        // celle du type principal, ni celle du contexte `stream` par celle du chat).
        const waiting = ctx.peerStore.getWaitingRemotePeerId(userSlug, room, requestedType)
        if (waiting) {
            const age = Date.now() - (waiting.createdAt ?? 0)

            // Si on a déjà demandé ce peerId récemment, on évite le spam réseau.
            if (age < SIGNALING_STALE_MS) {
                return false
            }
        }

        // Plafond d'émission, dernier garde avant le réseau. Il ne se déclenche que
        // lorsque le garde `waiting` ci-dessus a été contourné — soit parce que
        // l'entrée du store a été purgée (invalidateRemotePeerId, départ de room,
        // réponse reçue), soit parce qu'un remontage a rejoué syncUsersConnections.
        // Même granularité de clé que ce garde : le type demandé discrimine, sinon
        // la demande 'screen' serait étranglée par celle du type principal.
        const rateKey = `${userSlug}|${room}|${requestedType}`
        if (_askPeerRateLimiter.isLimited(rateKey)) {
            console.warn(
                `[usePeerCore] Rate limit dépassé (${ASK_PEER_MAX_REQUESTS_PER_WINDOW} demandes/${ASK_PEER_RATE_WINDOW_MS}ms)` +
                ` — demande de peerId pour '${userSlug}' (${requestedType}) abandonnée`
            )
            return false
        }

        try {
            await ctx.AjaxService.load(ENDPOINTS.ASK_TO_PEER_ID, 'post', {
                toUserSlug: userSlug,
                room: room,
                type: type,
                connectionType: requestedType,
                // Embarqué sur une demande qui partait déjà : c'est ce qui permet à
                // l'arrivant d'afficher sa vignette d'attente sans attendre un contact
                // P2P (cf. useBroadcastPresence.noteBroadcastFromSignal). Un vrai booléen
                // JSON — la règle `boolean` de Laravel refuse la chaîne "true".
                isBroadcasting: ctx.isBroadcasting.value === true
            })
            // `contextId` = propriétaire de la demande : c'est ce qui permet de la purger
            // au démontage de CE contexte, sans toucher à celles de ses voisins.
            ctx.peerStore.addWaitingRemotePeerId(userSlug, {
                room,
                type: requestedType,
                contextId: ctx.contextId,
            })
            return true
        } catch (e) {
            console.error('[usePeerCore] requestRemotePeerConnection failed:', e)
            return false
        }
    }

    /**
     * Répond à une demande de connexion d'un peer distant en lui envoyant notre peerId.
     *
     * @param {Object} payload - { fromUserSlug, room, type }
     * @returns {Promise<boolean>} false si le peer local n'est pas prêt, si le demandeur
     *                             n'est pas autorisé, ou si le POST échoue
     */
    const responseRemotePeerConnection = async (payload) => {

        // Sans peerId local on POSTerait `peerId: null` : le pair distant ne pourrait
        // jamais se connecter et rien ne réessaierait sur ce chemin. Symétrique de la
        // garde de requestRemotePeerConnection.
        // ⚠️ Cette garde reste nécessaire malgré le waitForMeReady de useSignalingQueue :
        // celui-ci attend `peerStore.lastLocalPeerId` (réactif), alors qu'on lit ici
        // `localPeer.id`, remis à null par peer.reconnect() — les deux peuvent diverger.
        const localPeerId = ctx.peerStore.getLocalPeerId
        if (!localPeerId) {
            console.warn('[usePeerCore] responseRemotePeerConnection: localPeer pas encore prêt')
            return false
        }

        // Garde d'autorisation du DEMANDEUR — même prédicat que le garde sortant de
        // `connectToPeer` (utils/isAuthorizedPeer.js) : une seule définition de « pair
        // autorisé », les deux chemins d'un même contexte ne peuvent pas diverger.
        //
        // Ce payload vient de la signalisation, donc de n'importe quel authentifié.
        // Répondre sans condition, c'est offrir la récolte de peerId à la demande : le
        // peerId local est la matière première des deux failles voisines — ouverture de
        // connexion entrante sous une identité déclarée, et empoisonnement du mapping
        // slug → peerId qui sert d'allowlist à l'admission.
        //
        // ⚠️ `false`, jamais `true`. Ici comme dans `connectToPeer`, `true` signifie
        // « rien à conclure » côté appelant.
        //
        // ⚠️ Et surtout : le prédicat n'est évalué qu'une fois la présence CONNUE.
        // `remotePeers` vide ne dit pas « ce pair n'est pas membre », il dit « je ne sais
        // pas encore qui est membre » — et l'ordre de production met systématiquement
        // l'arrivant du mauvais côté : son `remotePeers` n'est écrit qu'après
        // `waitForMeReady` (donc après le peerId local), alors que la demande du
        // diffuseur ne coûte qu'un aller-retour HTTP + Reverb. Refuser sur cette
        // ignorance-là, c'est refuser le seul contact qui pouvait amener le flux : la
        // re-demande du diffuseur n'arrive que 12 s plus tard (SIGNALING_STALE_MS), et
        // son `peer.call` d'après resterait de toute façon bloqué par le garde entrant.
        if (!isAuthorizedPeer(payload?.fromUserSlug, ctx) && !ctx.connection.presenceSynced) {
            await ctx.waitForPresenceSync()
        }

        if (!isAuthorizedPeer(payload?.fromUserSlug, ctx)) {
            console.warn(
                '[usePeerCore] responseRemotePeerConnection: demandeur non autorisé — peerId non communiqué',
                {
                    fromUserSlug: payload?.fromUserSlug,
                    room: payload?.room,
                    type: payload?.type,
                    remotePeers: [...(ctx.connection?.remotePeers ?? [])],
                    isAuthorizedCallPeer: ctx.isAuthorizedCallPeer?.(payload?.fromUserSlug) === true,
                }
            )
            return false
        }

        try {
            await ctx.AjaxService.load(ENDPOINTS.RESPONSE_TO_PEER_ID, 'post', {
                peerId: localPeerId,
                toUserSlug: payload.fromUserSlug,
                room: payload.room,
                // Renvoyés tels que reçus : `type` route la réponse vers le bon contexte
                // du demandeur, `connectionType` lui dit quelle connexion ouvrir.
                type: payload.type,
                connectionType: payload.connectionType || payload.type,
                // Mon état, pas celui reçu : c'est la réponse qui informe le demandeur que
                // je diffuse déjà. Les deux directions comptent — la demande ci-dessus le
                // porte aussi — et la première arrivée gagne, le marquage étant idempotent.
                isBroadcasting: ctx.isBroadcasting.value === true
            })
            return true
        } catch (e) {
            console.error('[usePeerCore] responseRemotePeerConnection failed:', e)
            return false
        }
    }

    /*------  Connection avec accord ----------*/

    const requestAuthorizationRemotePeerId = async (payload) => {

        const localPeerId = ctx.peerStore.getLocalPeerId

        // Symétrique des gardes de `requestRemotePeerConnection` (:109) et
        // `responseRemotePeerConnection` (:181), qui manquait ici.
        //
        // ⚠️ Ce chemin-ci est le plus coûteux des trois à laisser passer : `data` — qui porte
        // `peerId` — est capturé par la closure du moteur de retry juste en dessous, et
        // ré-envoyé à l'identique à chaque tentative. Un `peerId: null` n'y était donc pas une
        // requête ratée mais une invitation DÉFINITIVEMENT invalide, réémise en boucle : le
        // destinataire pouvait accepter, il n'avait aucun id vers lequel se connecter.
        //
        // Refuser d'émettre est le bon comportement : l'appelant (`useCallManager.startCall`)
        // ignore le retour et l'utilisateur peut rappeler — alors qu'une invitation partie
        // avec un id nul ne se corrige plus.
        if (!localPeerId) {
            console.warn(
                '[usePeerCore] requestAuthorizationRemotePeerId : aucun peerId local —' +
                ` invitation vers "${payload?.toUserSlug}" non émise`,
                { identity: ctx.peerStore.peerIdentity?.() ?? null }
            )
            return null
        }

        const inviteId = payload?.inviteId || buildInviteId()
        const toUserSlug = payload.toUserSlug

        const data = {
            type: payload.type,
            action: 'peer-access-permission',
            room: ctx.session.currentCallRoomId,
            peerId: localPeerId,
            inviteId,
        }

        // ⚠️ Copie, jamais `data` lui-même : cet objet part tel quel au backend
        // (`options: data` ci-dessous) et n'a pas à porter un identifiant interne.
        ctx.peerStore.addWaitingRemotePeerId(toUserSlug, { ...data, contextId: ctx.contextId })

        // Éviction de la plus ancienne entrée si la Map atteint la limite
        if (userSlugToInviteId.size >= MAX_INVITE_RETRIES) {
            const oldestSlug = userSlugToInviteId.keys().next().value
            stopCallInviteRetryForUser(oldestSlug)
        }

        userSlugToInviteId.set(toUserSlug, inviteId)

        // Premier envoi immédiat
        try {
            await ctx.AjaxService.load(ENDPOINTS.SEND_ALERT_TO_USER, 'post', {
                toUserSlug,
                options: data
            })
        } catch (e) {
            console.error('[usePeerCore] requestAuthorizationRemotePeerId initial send failed:', e)
            // Le moteur de retry prendra le relais
        }

        // Planifie les tentatives suivantes via le moteur de retry partagé.
        // Le callback retourne true (stop) si l'invitation n'est plus en attente
        // (acceptée, refusée ou annulée), false pour continuer.
        inviteRetryManager.scheduleRetry(toUserSlug, 0, async (userSlug) => {
            if (!userSlugToInviteId.has(userSlug)) return true

            try {
                await ctx.AjaxService.load(ENDPOINTS.SEND_ALERT_TO_USER, 'post', {
                    toUserSlug: userSlug,
                    options: data
                })
            } catch (e) {
                console.error('[usePeerCore] requestAuthorizationRemotePeerId retry send failed:', e)
            }

            return !userSlugToInviteId.has(userSlug)
        })

        return inviteId
    }

    const sendAuthorizationRemotePeerId = async (payload) => {
        if (payload.status) {
            const localPeerId = ctx.peerStore.getLocalPeerId

            // ⚠️ Ici, contrairement aux trois autres gardes, on N'ANNULE PAS l'envoi : ce
            // message est une ACCEPTATION d'appel, et le refuser la perdrait pour de bon —
            // l'appelant a arrêté son retry (`stopCallInviteRetryForUser`) et la FSM du
            // receveur est déjà passée en RECEIVING, donc un second `answerCallFromPeer`
            // sortirait par le refus de transition sans jamais réémettre.
            //
            // On se contente de ne pas écrire un `null` : la clé est RETIRÉE. C'est ce que
            // les deux lecteurs attendent — `openCallBetweenPeer` et `acceptCallFromPeer`
            // conditionnent tous deux le mapping à `if (payload?.options?.peerId)` — et
            // `pool.requestOrConnectPeer`, appelé juste après côté appelant, redemandera le
            // peerId par `/ask-to-peer-id`, où le garde de `responseRemotePeerConnection`
            // répondra dès que le Peer sera prêt. L'acceptation passe, l'id se rattrape.
            if (localPeerId) {
                payload.options.peerId = localPeerId
            } else {
                delete payload.options.peerId
                console.warn(
                    '[usePeerCore] sendAuthorizationRemotePeerId : aucun peerId local —' +
                    ' acceptation envoyée SANS peerId (le pair le redemandera)',
                    { toUserSlug: payload?.fromUserSlug, identity: ctx.peerStore.peerIdentity?.() ?? null }
                )
            }
        }

        try {
            await ctx.AjaxService.load(ENDPOINTS.RESPONSE_TO_AUTHORIZATION_PEER, 'post', {
                toUserSlug: payload.fromUserSlug,
                options: payload.status ? payload.options : { type: payload.options.type }, // on envoie les infos de connexion seulement si l'accès est autorisé, sinon on précise juste le type d'appel pour que le client puisse réagir (ex: afficher une notification d'appel refusé)
                status: payload.status
            })
        } catch (e) {
            console.error('[usePeerCore] sendAuthorizationRemotePeerId failed:', e)
        }
    }

    const notifyCloseConnectionToPeer = async (payload) => {
        const toUserSlug = payload?.toUserSlug
        const type = payload?.type || 'visio'
        const room = payload?.room || ctx.session.currentCallRoomId || ctx.session.currentRoom

        if (!toUserSlug || !room) return

        try {
            await ctx.AjaxService.load(ENDPOINTS.CLOSE_CONNECTION_TO_PEER_ID, 'post', {
                toUserSlug,
                fromUserSlug: ctx.mySlug.value,
                room,
                type,
            })
        } catch (e) {
            console.error('[usePeerCore] notifyCloseConnectionToPeer failed:', e)
        }
    }

    // ⚠️ Le routage des signaux entrants (PEER_CONNECTION_REQUEST →
    // responseRemotePeerConnection) vit dans useSignalingQueue : ce composable
    // n'expose que les verbes de signalisation, il n'observe plus la file.

    onUnmounted(() => {
        clearAllCallInviteRetries()
    })

    return {
        requestRemotePeerConnection,
        responseRemotePeerConnection,
        requestAuthorizationRemotePeerId,
        sendAuthorizationRemotePeerId,
        notifyCloseConnectionToPeer,
        stopCallInviteRetry,
        stopCallInviteRetryForUser,
        clearAllCallInviteRetries,

        /*---------------------------------
        | ÉTAT INTERNE (observable / debug)
        ----------------------------------*/
        // Instance module-level : `reset()` est le seul moyen de repartir d'une
        // fenêtre vierge en test, où `vi.useFakeTimers()` gèle `Date.now()`.
        askPeerRateLimiter: _askPeerRateLimiter,
    }
}