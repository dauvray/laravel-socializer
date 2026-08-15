/**
 * ☎️ useCallManager (Call Layer)
 *
 *  cycle de vie d'un appel : invite → accept → open → stop → reset
 *
 * 👉 gère :
 * - les transitions de la machine d'état d'appel (ctx.callMachine)
 * - l'ID de room d'appel et la liste des participants
 * - l'arrêt partiel (un pair) et complet (tout l'appel), local ou distant
 * - le **départ d'un pair** (`handleRemoteDeparture`) : séquence unique quel que
 *   soit le transport qui l'a annoncé (signal serveur ou fermeture PeerJS)
 * - les retries d'invitation (délégués à usePeerCore)
 *
 * 👉 utilise (par injection, jamais par import) :
 * - usePeerCore (signalisation), usePeerMedia (stream + players),
 *   usePeerConnections (fermeture), usePeerTransport (peer local),
 *   useConnectionPool (établissement + annulation des retries)
 *
 * 👉 ne connaît PAS :
 * - l'orchestrateur ni useStreamManager : aucune couche supérieure ne lui est injectée
 * - l'UI métier ni les composants Vue
 *
 * 🔒 Seul propriétaire de `ctx.callMachine` en dehors de `createPeerContext` : la
 * couche streams passe par les verbes `markCallConnected` / `isRemoteClosing` /
 * `beginRemoteClosing` / `endRemoteClosing` plutôt que de transitionner elle-même.
 *
 * 🔒 Seul ÉCRIVAIN de `session.authorizedCallPeers` (allowlist du garde sortant) : un
 * appel direct autorisé est un fait de cette couche et d'aucune autre. Les autres
 * couches ne font que lire, via `ctx.isAuthorizedCallPeer`.
 */

import { CALL_STATES } from '~socializer/components/WebRTC2/Composables/utils/useCallStateMachine.js'
import { isValidSlug, isValidCallType } from '~socializer/components/WebRTC2/Composables/utils/validators.js'

export function useCallManager(ctx, { core, media, connections, transport, pool }) {

    /*---------------------
    | ROOM D'APPEL
    ------------------------*/

    const setCurrentCallRoomId = (roomId = null) => {
        ctx.session.currentCallRoomId = roomId || null
        return ctx.session.currentCallRoomId
    }

    /**
     * Retourne un ID de room valide pour les appels, en utilisant l'ID préféré si fourni,
     * ou en générant un nouvel ID si nécessaire.
     * @param {*} preferred
     * @returns
     */
    const ensureCurrentCallRoomId = (preferred = null) => {
        if (preferred) {
            ctx.session.currentCallRoomId = preferred
            return ctx.session.currentCallRoomId
        }

        if (!ctx.session.currentCallRoomId) {
            ctx.session.currentCallRoomId = crypto.randomUUID()
        }

        return ctx.session.currentCallRoomId
    }

    /*---------------------
    | ÉTAT
    ------------------------*/

    const isCallInProgress = () => {
        return ctx.callMachine.callInprogress.value
    }

    const callStatus = () => {
        return ctx.callStatus.value
    }

    /**
     * Confirme qu'un appel reçu est réellement établi.
     * Appelé par la couche streams (`useStreamManager`) quand le premier flux distant
     * arrive : c'est elle qui observe le flux, mais c'est ici qu'on décide de la
     * transition — la FSM n'a qu'un seul propriétaire.
     *
     * @returns {boolean} true si la transition a eu lieu
     */
    const markCallConnected = () => {
        if (ctx.callMachine.callState.value !== CALL_STATES.RECEIVING) return false
        return ctx.callMachine.transition(CALL_STATES.CONNECTED)
    }

    /*---------------------
    | GARDE PAR PARTICIPANT
    | Fermetures individuelles concurrentes : orthogonal à l'état global (plusieurs
    | départs peuvent coexister en CONNECTED sans déclencher de CLOSING).
    | Exposé pour que la couche streams n'ait pas à toucher ctx.callMachine.
    ------------------------*/

    const isRemoteClosing    = (userSlug) => ctx.callMachine.isUserClosing(userSlug)
    const beginRemoteClosing = (userSlug) => ctx.callMachine.markUserClosing(userSlug)
    const endRemoteClosing   = (userSlug) => ctx.callMachine.unmarkUserClosing(userSlug)

    /*---------------------
    | OUVERTURE D'APPEL
    ------------------------*/

    const startCallWithPeer = (payload) => {
        if (!payload || typeof payload !== 'object') return
        if (!isValidSlug(payload.toUserSlug)) return

        // S'assure qu'un Peer existe (idempotent, et ne recrée rien s'il est déjà là).
        // ⚠️ Volontairement sans garde sur la valeur de retour, et sans `await` :
        // `setLocalPeer` est `async` — elle renvoie donc TOUJOURS une promesse truthy — et
        // sort par un `return` nu (donc `undefined`) sur ses chemins « rien à faire », dont
        // celui où le peer est DÉJÀ PRÊT. Un `if (!ready) return`, une fois awaité, avorterait
        // donc l'appel exactement dans le cas nominal. L'invitation part sans attendre
        // l'`open` : c'est `waitForMeReady` qui porte cette attente, en aval.
        transport.setLocalPeer()

        const toUserSlug = payload.toUserSlug
        const type = isValidCallType(payload.type) ? payload.type : 'visio'

        // Room imposée par l'appelant (ex: salle déjà identifiée côté serveur).
        // Absente → ensureCurrentCallRoomId conserve la room courante ou en génère une.
        const room = (typeof payload.room === 'string' && payload.room.trim().length > 0)
            ? payload.room.trim()
            : null

        // Transition en premier : évite toute mutation d'état si un appel est déjà en cours.
        if (!ctx.callMachine.transition(CALL_STATES.CALLING)) return

        ensureCurrentCallRoomId(room)
        ctx.addCurrentCallUser(toUserSlug, type)
        ctx.session.currentType = type

        core.requestAuthorizationRemotePeerId({ toUserSlug, type })
        return
    }

    /**
     * Démarre la session d'appel locale.
     * Commun à `acceptCallFromPeer` (récepteur qui accepte) et `openCallBetweenPeer` (initiateur confirmé).
     * Configure l'état, démarre le stream local et crée l'élément vidéo local.
     *
     * @param {string}      fromUserSlug - Slug de l'interlocuteur
     * @param {string|null} room         - ID de room (null → conserve ou génère)
     * @param {string}      type         - Type d'appel (visio, vocal, …)
     */
    const _enterCallSession = async ({ fromUserSlug, room, type }) => {
        ensureCurrentCallRoomId(room)
        ctx.addCurrentCallUser(fromUserSlug, type)
        ctx.session.currentType = type

        await media.startCurrentStream(true)
        media.createVideoElement(
            { videoId: 'local-webcam', type, source: 'local' },
            ctx.media.currentStream
        )
    }

    const acceptCallFromPeer = async (payload) => {
        if (!payload || typeof payload !== 'object') return

        // Idem `startCallWithPeer` : appel nu, jamais de garde sur le retour (cf. le
        // commentaire là-bas — la valeur ne dit rien de l'état du peer).
        transport.setLocalPeer()

        if (payload?.status) {
            const fromUserSlug = payload?.fromUserSlug
            if (!isValidSlug(fromUserSlug)) return

            const room = payload?.options?.room || null
            const type = isValidCallType(payload?.options?.type) ? payload.options.type : 'visio'

            // Mapping peerId vérifié de l'initiateur : DOIT être posé AVANT que sa peer.call
            // n'arrive (autrement _isAuthorizedIncomingPeer ne pourra pas valider l'identité
            // PeerJS réelle). `core.sendAuthorizationRemotePeerId` écrase ensuite
            // `payload.options.peerId` avec le peerId LOCAL — d'où l'enregistrement ici.
            if (payload?.options?.peerId) {
                ctx.peerStore.addRemotePeerId(fromUserSlug, payload.options.peerId)
            }

            // J'accepte : ce pair a le droit que je lui ouvre une connexion, même s'il
            // n'est dans aucune room commune (visio 1-à-1). Marqué ici et pas dans
            // `_enterCallSession` : la réponse `status: true` part quoi qu'il arrive
            // ensuite (transition refusée comprise), le distant se connectera donc —
            // l'autorisation doit couvrir exactement ce que j'ai promis.
            // Pas conditionné à `options.peerId` : l'autorisation porte sur le pair, le
            // mapping sur son identité PeerJS. Deux faits distincts.
            ctx.markAuthorizedCallPeer(fromUserSlug)

            if (!ctx.callMachine.transition(CALL_STATES.RECEIVING)) return
            await _enterCallSession({ fromUserSlug, room, type })
        }

        // ✅ Ajouter l'inviteId dans les options retournées
        const options = payload?.options || {}
        if (payload?.options?.inviteId) {
            options.inviteId = payload.options.inviteId
        }

        core.sendAuthorizationRemotePeerId({ ...payload,
            options,  // ← assure que inviteId est inclus
        })
        return
    }

    const openCallBetweenPeer = async (payload) => {
        if (!payload || typeof payload !== 'object') return

        // Arrête le retry pour ce userSlug (fiable peu importe le retour de inviteId)
        if (payload?.fromUserSlug && isValidSlug(payload.fromUserSlug)) {
            core.stopCallInviteRetryForUser(payload.fromUserSlug)
        }

        if(!payload?.status) {
            ctx.removeCurrentCallUser(payload.fromUserSlug)
            if(ctx.session.currentCallUsers.length === 0) {
                await stopCallWithPeers([], false, {
                    mode: 'full',
                })
            }
            return
        }

        const fromUserSlug = payload?.fromUserSlug
        if (!isValidSlug(fromUserSlug)) return

        const room = payload?.options?.room || null
        const type = isValidCallType(payload?.options?.type) ? payload.options.type : 'visio'

        ctx.peerStore.removeWaitingRemotePeerId(fromUserSlug)
        ctx.peerStore.addRemotePeerId(fromUserSlug, payload.options.peerId)

        // Mon invitation a été acceptée : c'est moi qui vais ouvrir la connexion
        // (`pool.requestOrConnectPeer` juste en dessous), et ce pair n'est pas
        // nécessairement dans une room commune. Sans ce marquage, le garde sortant de
        // `connectToPeer` refuserait l'appel direct que je viens moi-même de demander.
        ctx.markAuthorizedCallPeer(fromUserSlug)

        if (!ctx.callMachine.transition(CALL_STATES.CONNECTED)) return
        await _enterCallSession({ fromUserSlug, room, type })

        pool.requestOrConnectPeer(fromUserSlug)
    }

    /*---------------------
    | FERMETURE D'APPEL
    ------------------------*/

    const stopCallWithPeers = async (users = [], notifyRemote = true, options = {}) => {
        const mode = options?.mode || 'full'

        // Garde full  : la transition vers CLOSING est le mutex du full stop.
        // Garde partial : géré par closingUsers (par utilisateur) en amont dans remoteStopCall.
        if (mode !== 'partial') {
            if (!ctx.callMachine.transition(CALL_STATES.CLOSING)) return
        }

        ctx.beginShutdown()  // 🛑 Bloquer les retries immédiatement

        try {
            const roomId = options?.roomId || ctx.session.currentCallRoomId || ctx.currentRoom.value

            const callType = ctx.session.currentType || 'visio'

            const normalizedUsers = (users || [])
                .map((u) => ({ userSlug: u?.userSlug || u?.slug, type: u?.type || callType }))
                .filter((u) => !!u.userSlug)

            if (notifyRemote) {
                normalizedUsers.forEach((u) => {
                    core.notifyCloseConnectionToPeer({
                        toUserSlug: u.userSlug,
                        type: u.type || callType,
                        room: roomId,
                    })
                })
            }

            if (mode === 'partial') {
                normalizedUsers.forEach((u) => {
                    pool.clearRetry(u.userSlug)
                    ctx.peerStore.removeWaitingRemotePeerId(u.userSlug)
                })

                connections.closePeerConnection({
                    room: roomId,
                    type: callType,
                    users: normalizedUsers.map((u) => u.userSlug),
                    clearSignalQueue: false,
                })

                return  // ✅ endShutdown dans le finally
            }

            // === MODE FULL ===
            pool.clearAllRetries()

            connections.closePeerConnection({
                room: roomId,
                type: callType,
                clearSignalQueue: true,
            })

            media.stopCurrentStream()
            media.removeVideoElement('local-webcam')
            ctx.session.currentCallRoomId = null

            resetCallState()  // → callMachine.reset() : CLOSING → IDLE
        } finally {
            // ✅ Réactive les retries quoi qu'il arrive. Sans ce finally, une exception
            // dans la fenêtre laissait shutdownCount à ≥ 1 pour la vie du contexte :
            // le moteur de retry sortait alors par `return true` (donc ANNULÉ, pas
            // différé) et plus aucune connexion ne se rétablissait, silencieusement.
            ctx.endShutdown()

            // Filet de sécurité : si resetCallState n'a pas été appelé (exception),
            // garantir qu'on ne reste pas coincé en état CLOSING.
            if (ctx.callMachine.isStopping.value) {
                ctx.callMachine.reset()
            }
        }
    }

    /*---------------------
    | DÉPART D'UN PAIR
    ------------------------*/

    /**
     * Purge les players et les entrées de registre d'un pair, quel que soit le type
     * de flux (visio + screen d'un même pair partent ensemble).
     *
     * ⚠️ Le filtre est `entry.remoteSlug` — normalisé à l'écriture par
     * `useStreamManager.handleStreamReceived` — et non `entry.metadata.from` :
     * côté initiateur, le flux distant arrive sur MA connexion sortante, dont
     * `metadata.from` porte MON slug (cf. `_buildPeerConnectionConfig`). Filtrer sur
     * `metadata.from` ne matchait donc jamais côté appelant, et l'entrée fuyait.
     *
     * @param {string} userSlug     Pair qui part
     * @param {string} declaredType Type annoncé par le déclencheur : son player peut
     *                              exister sans entrée de registre (raccroché avant
     *                              l'arrivée du premier flux).
     */
    const _purgePeerStreams = (userSlug, declaredType) => {
        media.removeVideoElement(`remote-${userSlug}-${declaredType}`)

        ctx.media.remoteStreamsMap.forEach((entry, key) => {
            if (entry?.remoteSlug !== userSlug) return

            // Une fermeture de connexion = UN type retiré. Les autres flux du pair
            // survivent : A qui arrête sa webcam garde son partage d'écran chez les
            // récepteurs.
            //
            // ⚠️ Ne PAS élargir la purge à tous les types du pair, et ne pas tenter de
            // la conditionner à `connections.hasOpenConnection` : côté RÉCEPTEUR il n'y a
            // rien à observer, `usePeerTransport` n'enregistre jamais les connexions
            // entrantes dans le store (un appel one-way se contente de `call.answer()` +
            // `setUpConnectionListeners`). Ce prédicat y répond donc toujours false.
            //
            // La purge élargie qui existait ici réparait une fuite de `alice-screen`, mais
            // sa cause réelle était la résolution du pair par `metadata.from` — corrigée
            // depuis par `entry.remoteSlug`. Chaque fermeture arrive maintenant avec son
            // propre `conn.metadata.type` et est routée pour tous les types en mode stream,
            // donc le pair finit bien entièrement nettoyé. Le filet pour un flux qui meurt
            // SANS événement de fermeture est le nettoyage par fin de pistes de
            // `useStreamManager`.
            if (entry.remoteType !== declaredType) return

            media.removeVideoElement(`remote-${entry.remoteSlug}-${entry.remoteType}`)
            ctx.media.remoteStreamsMap.delete(key)
        })
    }

    /**
     * Séquence unique de départ d'un pair.
     *
     * « Un pair quitte l'appel » est un seul fait métier, mais il arrive par deux
     * transports qui peuvent se déclencher tous les deux pour un même départ, dans
     * un ordre non déterministe :
     *   1. signal serveur `CloseConnectionToPeerID` → `remoteStopCall`
     *   2. fermeture de la connexion PeerJS       → `useStreamManager.handleStreamRemoved`
     *
     * Le déclencheur ne change PAS la séquence : c'est le **mode courant** qui décide
     * de la politique. En mode `stream` (broadcast unidirectionnel), le cycle de vie
     * du flux local appartient à l'utilisateur (`stopStream()`) : un départ distant
     * ne doit ni fermer le transport, ni arrêter la diffusion locale.
     *
     * `close-call` est idempotent par contrat : les deux déclencheurs peuvent
     * l'émettre pour un même départ (fenêtre de course inter-transports).
     *
     * @returns {boolean} true si la séquence a été exécutée (false = ignorée)
     */
    const handleRemoteDeparture = async ({ userSlug, type, roomId }) => {
        if (!userSlug || !isValidSlug(userSlug)) return false
        if (isRemoteClosing(userSlug)) return false

        const isCallMode = ctx.session.currentType !== 'stream'

        beginRemoteClosing(userSlug)

        try {
            // Coupe le lien réseau, les retries et le waiting peerId de CE pair.
            // Indispensable aussi quand le déclencheur est la fermeture PeerJS : sans
            // ça, une coupure brutale (onglet fermé, pas de signal serveur) laissait
            // le remotePeerId enregistré et le retry armé → reconnexion vers un pair
            // qui vient de partir.
            if (isCallMode) {
                await stopCallWithPeers([{ userSlug, type }], false, {
                    mode: 'partial',
                    roomId,
                })
            }

            ctx.removeCurrentCallUser(userSlug)
            _purgePeerStreams(userSlug, type)

            // Plus rien n'est en vol de la part de ce pair : son annonce de diffusion (ou
            // la trace de son appel entrant) doit tomber ici, sinon l'UI d'attente le
            // ferait « spinner » après un arrêt volontaire — exactement le symptôme
            // qu'avait la mémoire `served` de useAwaitedStreams, en mieux : s'il relance
            // sa diffusion, la nouvelle annonce fait réapparaître la vignette.
            ctx.clearAnnouncedStream?.(userSlug)

            // Ce pair est parti : son autorisation d'appel tombe avec lui. La laisser
            // vivre rendrait le garde sortant permissif pour la durée du contexte au
            // profit de quelqu'un qui n'est plus là — et le `data-app`, monté en
            // permanence, ne se démonte jamais pour la remettre à zéro.
            ctx.clearAuthorizedCallPeer(userSlug)

            ctx.eventBus.$emit('close-call', [{ userSlug, type }])

            // Plus personne en ligne → on ferme tout. `canTransition` évite le warn
            // de transition invalide quand le second déclencheur arrive après un full
            // stop déjà effectué par le premier (FSM déjà revenue à IDLE).
            if (isCallMode
                && ctx.session.currentCallUsers.length === 0
                && ctx.callMachine.canTransition(CALL_STATES.CLOSING)) {
                await stopCallWithPeers([], false, {
                    mode: 'full',
                    roomId,
                })
            }
        } catch (error) {
            console.error(`[useCallManager] départ du pair ${userSlug}`, error)
        } finally {
            // Toujours relâcher le garde : sinon tout départ ultérieur de ce pair
            // serait silencieusement avalé par `isRemoteClosing`.
            endRemoteClosing(userSlug)
        }

        return true
    }

    /**
     * Déclencheur 1 : le distant a raccroché (signal serveur `CloseConnectionToPeerID`).
     * Adapte le payload de signalisation puis délègue à la séquence commune.
     */
    const remoteStopCall = async (payload) => {
        if (!payload || typeof payload !== 'object') return

        await handleRemoteDeparture({
            userSlug: payload?.fromUserSlug || null,
            type: isValidCallType(payload?.type) ? payload.type : 'visio',
            roomId: payload?.room || ctx.session.currentCallRoomId || ctx.currentRoom.value,
        })
    }

    const resetCallState = () => {
        media.cleanupCallPlayers()
        ctx.callMachine.reset()  // CLOSING → IDLE + closingUsers.clear()
        ctx.clearCurrentCallUsers()
        ctx.clearAllAuthorizedCallPeers()  // plus d'appel ⇒ plus d'autorisation d'appel
        setCurrentCallRoomId(null)
        ctx.media.remoteStreamsMap.clear()
    }

    /*---------------------
    | RETRIES D'INVITATION
    ------------------------*/

    const stopCallInviteRetry = (inviteId) => {
        if (!inviteId) return
        core.stopCallInviteRetry(inviteId)
    }

    const clearAllCallInviteRetries = () => {
        core.clearAllCallInviteRetries()
    }

    return {
        // ouverture
        startCallWithPeer,
        acceptCallFromPeer,
        openCallBetweenPeer,

        // fermeture
        stopCallWithPeers,
        remoteStopCall,
        resetCallState,

        // départ d'un pair — séquence unique, quel que soit le transport
        handleRemoteDeparture,

        // room d'appel
        setCurrentCallRoomId,
        ensureCurrentCallRoomId,

        // état
        isCallInProgress,
        callStatus,

        // FSM — verbes destinés à la couche streams
        markCallConnected,
        isRemoteClosing,
        beginRemoteClosing,
        endRemoteClosing,

        // retries d'invitation
        stopCallInviteRetry,
        clearAllCallInviteRetries,
    }
}
