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
// ⚠️ `isValidCallType` reste utilisé sur les trois chemins ENTRANTS (`acceptCallFromPeer`,
// `openCallBetweenPeer`, `remoteStopCall`), et délibérément : ils sont symétriques de ce que
// les autres onglets émettent, et les durcir est un arbitrage de sécurité à part — item ouvert
// de `work/webrtc2-todo.md`. Seul le chemin SORTANT normalise, parce que c'est lui qui
// fabriquait le cul-de-sac.
import { isValidSlug, isValidCallType, normalizeDirectCallType } from '~socializer/components/WebRTC2/Composables/utils/validators.js'

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
     * Un flux distant est-il arrivé dans l'appel en cours ?
     *
     * Pas l'état de la FSM : l'initiateur passe CONNECTED dès la RÉCEPTION de l'acceptation
     * (`openCallBetweenPeer`), avant son propre `getUserMedia` et avant tout flux. Pas non plus le
     * registre des flux : `useStreamManager` en retire une entrée dès que ses pistes se terminent,
     * qui peut précéder le signal de fin d'appel — un raccroché passerait alors pour un appel
     * jamais établi. Le marqueur est la ROOM de l'appel, posée au premier flux : un appel suivant
     * en tire une neuve, donc un marqueur laissé par le précédent ne vaut rien pour lui.
     *
     * ⚠️ Même borne que les autres discriminants par room : un arrêt complet qui lève laisse la
     * room en place (`finally` de `stopCallWithPeers`), et l'appel suivant la conserve.
     */
    const isCallEstablished = () => {
        return ctx.session.currentCallRoomId !== null
            && ctx.session.establishedCallRoomId === ctx.session.currentCallRoomId
    }

    /**
     * Confirme qu'un appel reçu est réellement établi.
     * Appelé par la couche streams (`useStreamManager`) quand le premier flux distant
     * arrive : c'est elle qui observe le flux, mais c'est ici qu'on décide de la
     * transition — la FSM n'a qu'un seul propriétaire.
     *
     * Appelé aussi côté initiateur, déjà CONNECTED : la transition y est refusée, mais le
     * marqueur d'`isCallEstablished` est posé dans les deux sens.
     *
     * @returns {boolean} true si la transition a eu lieu
     */
    const markCallConnected = () => {
        if (ctx.session.currentCallRoomId) {
            ctx.session.establishedCallRoomId = ctx.session.currentCallRoomId
        }

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

    /**
     * Émet une invitation d'appel vers un pair.
     *
     * @param   {{toUserSlug: string, type?: string, room?: string}} payload
     * @returns {Promise<?string>} l'`inviteId` si l'invitation est partie ; `null` si elle a
     *          été refusée APRÈS avoir engagé la FSM (l'appelant doit alors prévenir
     *          l'utilisateur) ; `undefined` si le payload était irrecevable — auquel cas rien
     *          n'a été engagé et il n'y a personne à prévenir.
     *
     * ⚠️ Le corps est `async` mais **le mutex n'a PAS bougé**, et c'est ce qui rend le
     * changement sûr : un corps `async` s'exécute synchronement jusqu'à son premier `await`, et
     * `transition(CALLING)` est AVANT lui. Deux clics rapprochés restent donc départagés
     * exactement comme avant. C'est ce qui distingue cette modification de celle que
     * `docs/modules/webrtc2/flux.md` interdit — awaiter `setLocalPeer()` —, qui placerait la
     * transition APRÈS une suspension et ouvrirait la fenêtre.
     */
    const startCallWithPeer = async (payload) => {
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
        // ⚠️ `normalizeDirectCallType` et NON `isValidCallType` : ce dernier est dérivé de
        // `VALID_CONNECTION_TYPES`, donc il accepte aussi `data`/`stream`/`screen`. Le repli
        // qui était ici ne rattrapait donc pas un `type: 'screen'` — il passait en CALLING puis
        // mourait à l'ouverture de connexion, où `config.stream` vaut `null` et où le
        // `return true` ANNULE le retry. Un appel direct n'a que deux types.
        const type = normalizeDirectCallType(payload.type)

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

        const inviteId = await core.requestAuthorizationRemotePeerId({ toUserSlug, type })

        // ⚠️ Le refus le plus coûteux du module, et il était SILENCIEUX.
        //
        // `requestAuthorizationRemotePeerId` rend `null` quand il n'y a pas de peerId local
        // publiable — refuser d'émettre est le bon geste, une invitation partie avec un id nul
        // ne se corrige plus. Mais à ce moment la FSM est déjà en CALLING, et le moteur de
        // retry n'est PAS armé : le `return null` précède `scheduleRetry`. Sans la reprise
        // ci-dessous, la FSM restait donc en CALLING **pour la vie de l'onglet** — `callStatus`
        // bloqué, `CallManagerBtn` réduit à un spinner (le bouton « annuler » n'y existe que
        // depuis le 2026-10-27), et surtout plus AUCUN appel possible, `transition(CALLING)`
        // depuis `calling` étant invalide.
        //
        // La reprise ne réinvente rien : c'est `openCallBetweenPeer({status:false})`, le chemin
        // qu'emprunte déjà un refus distant (`Notifications.vue`, `.ResponseToAuthorizationPeer`)
        // et un abandon du moteur de retry. Sa branche `!status` retire le participant puis,
        // s'il était le dernier, fait le full stop CALLING → CLOSING → IDLE.
        if (!inviteId) {
            await openCallBetweenPeer({
                fromUserSlug: toUserSlug,
                status: false,
                options: { type },
            })
            return null
        }

        return inviteId
    }

    /**
     * Capture le flux local d'un appel. Une caméra OUVERTE qui ne peut pas être capturée — absente,
     * prise par une autre application, ou refusée seule dans les réglages du site — ne fait plus
     * échouer l'appel : il continue caméra coupée, un bouche-trou à sa place, et l'UI l'annonce
     * (`mediaUnavailableSignal`). Décision de David du 2026-10-30, pour l'appelé comme pour
     * l'appelant. `startCurrentStream` garde, lui, son contrat (l'échec remonte) : la diffusion le
     * rattrape et nomme la cause (`GroupLocalStreamBtn`).
     *
     * Le repli ne recapture que si la caméra était demandée quand la capture est partie — sinon le
     * rejet vient du micro, et recapturer sans caméra rejetterait pareil — et que l'appel est encore
     * voulu : la seconde capture peut rouvrir une invite de permission. Le drapeau vaut « coupée »
     * pendant la seconde capture (le bouche-trou en dépend), et ne le reste que si elle réussit : si
     * elle rejette aussi, c'est le micro qui manque, et la caméra retrouve son réglage. Ce qui lève encore — le micro manque, ou le repli fermé
     * redemande la caméra — est la sortie propre de l'appel (`_leaveUncapturableCall`).
     *
     * @returns {Promise<?{device: 'camera', name: ?string}>} la cause quand l'appel part caméra
     *          coupée faute de caméra ; `null` sinon, y compris pour un appel arrêté pendant la
     *          capture, et pour une caméra que l'utilisateur a coupée pendant l'invite.
     */
    const _startCallStream = async (type, callRoomId) => {
        const cameraRequested = type !== 'vocal' && ctx.ui.streamStates.isVideoEnabled
        const isStillWanted = () => ctx.session.currentCallRoomId === callRoomId

        let cameraError
        try {
            await media.startCurrentStream(type)
            return null
        } catch (error) {
            // Arrêté pendant l'invite : la garde de room d'`_enterCallSession` sort, sans rien
            // recapturer ni annoncer.
            if (!isStillWanted()) return null
            if (!cameraRequested) throw error
            cameraError = error
        }

        const videoWanted = ctx.ui.streamStates.isVideoEnabled
        ctx.ui.streamStates.isVideoEnabled = false
        try {
            await media.startCurrentStream(type)
        } catch (error) {
            ctx.ui.streamStates.isVideoEnabled = videoWanted
            if (!isStillWanted()) return null
            throw error
        }

        console.warn('[useCallManager] caméra indisponible au démarrage de l\'appel — il continue caméra coupée', {
            name: cameraError?.name ?? null,
        })
        // Coupée par l'utilisateur pendant l'invite : rien à lui apprendre.
        return videoWanted ? { device: 'camera', name: cameraError?.name ?? null } : null
    }

    /**
     * Sort d'un appel dont le flux local ne peut pas être capturé du tout : le micro manque (refusé,
     * absent, pris), ou le repli fermé redemande une caméra indisponible. Décision de David du
     * 2026-10-30 : l'appel sort proprement, au lieu de rester suspendu. L'arrêt complet ramène la
     * FSM au repos, et `notifyRemote` prévient le pair — l'appelant raccroche ; l'appelé, lui,
     * refuse, ce que fait son appelant. `close-call` réarme le bouton d'appel du mur, et le signal
     * fait dire la cause par l'UI.
     *
     * Borne : `getUserMedia` ne dit pas quel périphérique a manqué. Dans le repli fermé (un
     * navigateur sans capture canvas), c'est peut-être la caméra, sous le toast du micro.
     */
    const _leaveUncapturableCall = async ({ fromUserSlug, type, error, notifyRemote }) => {
        console.warn('[useCallManager] aucun flux local possible — l\'appel ne peut pas démarrer', {
            name: error?.name ?? null,
        })
        ctx.mediaUnavailableSignal.value = { device: 'microphone', name: error?.name ?? null }
        ctx.eventBus.$emit('close-call', [{ userSlug: fromUserSlug, type }])
        await stopCallWithPeers([{ userSlug: fromUserSlug, type }], notifyRemote, { mode: 'full' })
    }

    /**
     * Démarre la session d'appel locale.
     * Commun à `acceptCallFromPeer` (récepteur qui accepte) et `openCallBetweenPeer` (initiateur confirmé).
     * Configure l'état, démarre le stream local et crée l'élément vidéo local.
     *
     * @param {string}      fromUserSlug - Slug de l'interlocuteur
     * @param {string|null} room         - ID de room (null → conserve ou génère)
     * @param {string}      type         - Type d'appel (visio, vocal, …)
     * @returns {Promise<boolean>} false si l'appel s'est arrêté pendant l'acquisition du flux
     *          local : l'appelant ne doit plus rien faire en son nom.
     */
    const _enterCallSession = async ({ fromUserSlug, room, type }) => {
        const callRoomId = ensureCurrentCallRoomId(room)
        ctx.addCurrentCallUser(fromUserSlug, type)
        ctx.session.currentType = type

        // Le TYPE d'appel, et non `true` : cet argument était ignoré (la fonction n'en prenait
        // aucun), si bien qu'un appel `vocal` capturait et transmettait une piste vidéo.
        const cameraUnavailable = await _startCallStream(type, callRoomId)

        // ⚠️ `getUserMedia` dure autant que l'invite de permission reste ouverte, et pendant ce
        // temps la barre d'appel offre « annuler » (RECEIVING) ou « raccrocher » (CONNECTED) ; un
        // départ du pair peut aussi tomber. L'arrêt complet ne coupe pas un flux qui n'existe pas
        // encore, et il remet la room à `null`. Sans ce garde, le flux arrivait APRÈS lui : caméra
        // et micro ouverts en IDLE, player local hors appel, puis l'acceptation (appelé) ou la
        // connexion (initiateur) envoyée au nom d'un appel fini.
        //
        // La ROOM et non l'état de la FSM : annuler puis appeler aussitôt quelqu'un d'autre remet la
        // FSM hors d'IDLE avant que l'invite se referme, et ce flux entrerait dans l'autre appel.
        // Bornes. Deux acquisitions concurrentes — deux appels acceptés pendant la même invite —
        // ne sont pas départagées, `startCurrentStream` écrivant `currentStream` sans condition.
        // Et la room n'est neuve que parce que l'arrêt complet la VIDE : un appel suivant qui
        // imposerait la même room (appels depuis une room, différés) passerait ce garde, comme un
        // arrêt qui lève avant de la vider — le `finally` de `stopCallWithPeers` remet la FSM à
        // IDLE sans toucher à la room. Items de `work/webrtc2-todo.md`.
        if (ctx.session.currentCallRoomId !== callRoomId) {
            media.stopCurrentStream()
            return false
        }

        // Annoncé une fois l'appel confirmé vivant : un appel arrêté entre-temps n'a rien à dire.
        if (cameraUnavailable) ctx.mediaUnavailableSignal.value = cameraUnavailable

        const me = ctx.meStore.getMe

        media.createVideoElement(
            {
                videoId: 'local-webcam',
                type,
                source: 'local',
                roomId: ctx.session.currentCallRoomId,
                // `isMe` n'est pas décoratif : c'est lui qui coupe le son du player local
                // (cf. MediaBroadcastPlayer.isLocallyMuted). Sans métadonnées, ma propre
                // voix me revenait dans les oreilles.
                metadata: {
                    from: me?.slug || null,
                    fromName: me?.name || me?.slug || null,
                    room: ctx.session.currentCallRoomId,
                    currentType: type,
                    isMe: true,
                    isAudioMuted: ctx.ui.streamStates.isMuted,
                    isVideoEnabled: ctx.ui.streamStates.isVideoEnabled,
                },
            },
            ctx.media.currentStream
        )

        return true
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
            // n'est dans aucune room commune (visio 1-à-1).
            // ⚠️ Marqué AVANT la transition, alors que la réponse ne part qu'APRÈS
            // `_enterCallSession` : une transition refusée (déjà en appel) sort sans réponse et
            // laisse la marque jusqu'au reset de l'appel en cours ; un arrêt pendant
            // l'acquisition du flux sort sans réponse aussi, la marque étant alors effacée par
            // l'arrêt. Une capture impossible ne sort plus sans réponse : elle REFUSE l'appel,
            // puis l'arrêt complet efface la marque. Ce commentaire disait la réponse partie
            // « transition refusée comprise » :
            // faux, le `return` la précède — item ouvert de `work/webrtc2-todo.md`.
            // Pas conditionné à `options.peerId` : l'autorisation porte sur le pair, le
            // mapping sur son identité PeerJS. Deux faits distincts.
            ctx.markAuthorizedCallPeer(fromUserSlug)

            if (!ctx.callMachine.transition(CALL_STATES.RECEIVING)) return

            let entered
            try {
                entered = await _enterCallSession({ fromUserSlug, room, type })
            } catch (error) {
                // Aucun flux possible : l'appelé revient au repos, puis REFUSE l'appel. Le repos
                // d'abord : le refus part ensuite, et aucune annulation ni aucun rappel ne tombe
                // entre les deux (l'annulation y faisait annoncer un micro absent pour un appel
                // fini). Le refus dans un `finally` : sans lui, l'appelant attendrait l'abandon de
                // sa relance, même si l'arrêt lève.
                try {
                    await _leaveUncapturableCall({ fromUserSlug, type, error, notifyRemote: false })
                } finally {
                    await core.sendAuthorizationRemotePeerId({ ...payload, status: false, options: { ...payload.options } })
                }
                return
            }
            // Arrêté pendant l'invite de permission : pas d'acceptation, elle partirait au nom
            // d'un appel fini.
            if (!entered) return
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

    /**
     * Un refus vaut-il pour l'invitation en vol ? S'il porte un `inviteId`, il ne vaut que pour
     * cette invitation-là, et il la consomme.
     *
     * Sans ça, un refus était imputé à l'appel EN COURS, quel qu'il soit : le refus adressé à
     * l'invitation d'un autre onglet coupait l'appel établi de celui-ci, et celui d'une alerte
     * fermée avant un rappel coupait le rappel. La comparaison porte sur l'`inviteId` de l'entrée en
     * vol, et non sur sa seule présence : la clé (slug, room, type) d'un rappel peut coïncider, dès
     * qu'un appelant impose la room (`startCallWithPeer({ room })`).
     *
     * ⚠️ Ce n'est que la moitié APPELANTE de « annuler puis rappeler ». Rappelé pendant que sa
     * première alerte sonne, l'appelé la remplace (`:key` de `Notifications.vue`) : sans ça, le
     * minuteur de la première refusait le rappel avec l'`inviteId` du rappel — légitime ici.
     *
     * Sans `inviteId`, l'ancien sens est gardé — « ce pair refuse l'appel en cours » : c'est le
     * cas d'un appelé sur un bundle antérieur, et des deux reprises internes (l'abandon du moteur
     * de retry, le `!inviteId` de `startCallWithPeer`), qui portent par construction sur
     * l'invitation vivante. Les ignorer laisserait l'appelant en `calling`.
     *
     * @param   {object}  payload - Réponse `.ResponseToAuthorizationPeer` en `status: false`
     * @returns {boolean} false si le refus est périmé et doit être ignoré
     */
    const _consumeRefusedInvitation = (payload) => {
        const inviteId = payload?.options?.inviteId
        if (!inviteId) return true

        const fromUserSlug = payload?.fromUserSlug
        const room = payload?.options?.room || ctx.session.currentCallRoomId
        const type = isValidCallType(payload?.options?.type) ? payload.options.type : 'visio'

        if (ctx.peerStore.getWaitingRemotePeerId(fromUserSlug, room, type)?.inviteId !== inviteId) {
            console.warn(
                '[useCallManager] refus d\'une invitation qui n\'est plus en vol — ignoré',
                { fromUserSlug, room, type, inviteId, contextId: ctx.contextId },
            )
            return false
        }

        ctx.peerStore.removeWaitingRemotePeerId(fromUserSlug, room, type)
        return true
    }

    /**
     * Applique la réponse d'un pair invité — acceptation ou refus — et dit si elle valait pour
     * l'invitation en vol.
     *
     * Le verdict est lu par `Notifications.vue`, qui n'annonce un refus (« … est injoignable »,
     * `close-call`) que s'il a été consommé ici. L'invitation sonne sur TOUS les onglets de
     * l'appelé : quand l'un répond, les autres sonnent jusqu'à leur auto-refus, qui arrive avec le
     * même `inviteId` — en pleine conversation, ou après que l'appelé a annulé. La FSM l'ignorait
     * déjà ; le toast partait quand même, et réarmait le bouton d'appel du mur.
     *
     * @param   {object}  payload - Réponse `.ResponseToAuthorizationPeer`
     * @returns {Promise<boolean>} true si la réponse a été consommée — refus de l'invitation en vol
     *                             (ou sans `inviteId`, ancien sens), acceptation qui passe la garde,
     *                             même si la transition ou l'entrée en session échouent ensuite ;
     *                             false si elle est périmée ou invalide.
     */
    const openCallBetweenPeer = async (payload) => {
        if (!payload || typeof payload !== 'object') return false

        // Arrête le retry pour ce userSlug (fiable peu importe le retour de inviteId).
        //
        // ⚠️ Appelé APRÈS les gardes des deux branches, jamais en tête : l'arrêt porte sur le
        // slug, donc sur l'invitation VIVANTE vers ce pair, quelle que soit celle à laquelle
        // la réponse répond. En tête, la réponse périmée d'une alerte annulée éteignait la
        // relance du rappel — qui restait alors en `calling` sans relance ni abandon.
        const stopInviteRetry = () => {
            if (payload?.fromUserSlug && isValidSlug(payload.fromUserSlug)) {
                core.stopCallInviteRetryForUser(payload.fromUserSlug)
            }
        }

        if(!payload?.status) {
            if (!_consumeRefusedInvitation(payload)) return false
            stopInviteRetry()

            ctx.removeCurrentCallUser(payload.fromUserSlug)
            if(ctx.session.currentCallUsers.length === 0) {
                await stopCallWithPeers([], false, {
                    mode: 'full',
                })
            }
            return true
        }

        const fromUserSlug = payload?.fromUserSlug
        if (!isValidSlug(fromUserSlug)) return false

        const room = payload?.options?.room || null
        const type = isValidCallType(payload?.options?.type) ? payload.options.type : 'visio'

        // Clé exacte de MA demande — `requestAuthorizationRemotePeerId` l'a enregistrée
        // sur (slug, currentCallRoomId, type), et `room` est cette room, renvoyée telle
        // quelle par le distant. Lire ou purger sur le slug seul emporterait les demandes
        // des autres contextes de l'onglet, qui n'ont rien à voir avec cet appel.
        const callRoom = room || ctx.session.currentCallRoomId

        // ⚠️ Une acceptation ne vaut QUE pour une invitation que cet onglet a émise.
        //
        // Sans cette garde, un POST forgé sur `/response-to-authorization-peer` suffisait
        // à se faire inscrire dans `authorizedCallPeers` et dans le mapping peerId d'une
        // victime qui n'a jamais invité personne. Le refus de la FSM juste en dessous
        // (IDLE → CONNECTED est une transition invalide) ne protégeait rien : les deux
        // écritures le précédaient. Or `authorizedCallPeers` est la seconde branche
        // d'`utils/isAuthorizedPeer.js` — l'attaquant obtenait donc ensuite le peerId
        // local (garde de `responseRemotePeerConnection`) ET l'ouverture de connexion
        // (garde de `connectToPeer`) : les lots A et B étaient contournés par cette route.
        //
        // Le client peut trancher ce cas seul, contrairement à l'usurpation intra-room :
        // « ai-je invité ce pair ? » est un fait purement local.
        //
        // Pas de contrôle du `contextId` de la demande, bien que le store soit partagé par
        // l'onglet : `openCallBetweenPeer` ne s'exécute que dans le contexte de
        // `Notifications.vue`, seul destinataire de `.ResponseToAuthorizationPeer`, alors
        // que `startCallWithPeer` est exposé par toute instance de `useMediaBroadcast`.
        // L'exiger casserait un appel initié depuis un provider de room.
        if (!ctx.peerStore.hasWaitingRemotePeerId(fromUserSlug, callRoom, type)) {
            console.warn(
                '[useCallManager] acceptation d\'appel sans invitation en vol — ignorée',
                { fromUserSlug, room: callRoom, type, contextId: ctx.contextId },
            )
            return false
        }

        stopInviteRetry()

        // L'invitation est acceptée : MA demande d'autorisation n'est plus en vol.
        ctx.peerStore.removeWaitingRemotePeerId(fromUserSlug, callRoom, type)

        // Conditionné à la présence du peerId, comme `acceptCallFromPeer` : le payload
        // vient du réseau, une écriture inconditionnelle mappait `undefined`.
        if (payload?.options?.peerId) {
            ctx.peerStore.addRemotePeerId(fromUserSlug, payload.options.peerId)
        }

        // Mon invitation a été acceptée : c'est moi qui vais ouvrir la connexion
        // (`pool.requestOrConnectPeer` juste en dessous), et ce pair n'est pas
        // nécessairement dans une room commune. Sans ce marquage, le garde sortant de
        // `connectToPeer` refuserait l'appel direct que je viens moi-même de demander.
        ctx.markAuthorizedCallPeer(fromUserSlug)

        if (!ctx.callMachine.transition(CALL_STATES.CONNECTED)) return true

        let entered
        try {
            entered = await _enterCallSession({ fromUserSlug, room, type })
        } catch (error) {
            // Aucun flux possible : raccrocher en prévenant l'appelé, qui a déjà accepté et
            // attendrait un appel qui ne viendra pas. La relance est déjà arrêtée (plus haut).
            await _leaveUncapturableCall({ fromUserSlug, type, error, notifyRemote: true })
            return true
        }
        if (!entered) return true

        pool.requestOrConnectPeer(fromUserSlug)
        return true
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
                    // Scopé sur la room de l'appel : les demandes des autres contextes
                    // (chat, diffusion) survivent à la fin de CET appel.
                    ctx.peerStore.clearWaitingRemotePeerIds(u.userSlug, roomId)
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

            // L'appel s'arrête, ses invitations aussi : la chaîne de relance ET l'entrée en
            // vol qui rend une acceptation recevable. `pool.clearAllRetries` n'éteint que le
            // moteur des connexions, et `closePeerConnection` ne purge rien pendant
            // `calling` (aucune connexion dans la room d'appel).
            //
            // Sans ça, un arrêt pendant `calling` laissait partir les relances restantes vers
            // l'appelé, puis l'abandon tombait environ 55 s après l'invitation, que
            // `Notifications.vue` rejoue en refus — donc contre ce pair, même s'il a rejoint
            // un autre appel entre-temps. Et une acceptation de l'invitation déjà livrée
            // passait encore la garde d'`openCallBetweenPeer` : allowlist et mapping peerId
            // écrits hors appel en IDLE, et, si j'appelais déjà quelqu'un d'autre, l'appelé
            // annulé ENTRAIT dans ce nouvel appel (CALLING → CONNECTED).
            core.clearAllCallInviteRetries()
            ctx.peerStore.clearCallInvitesForContext(ctx.contextId)

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

            // Un appel démarre micro ouvert — ici et non dans `resetCallState`, pour tenir aussi
            // quand l'arrêt complet a levé avant lui. `startCurrentStream` demande
            // `audio: !isMuted` : un micro coupé reporté à l'appel suivant y capturait un flux
            // SANS piste audio, que la bascule ne rattrape pas — et en vocal,
            // `{ video: false, audio: false }` fait rejeter la capture. La caméra, elle, garde
            // son réglage d'un appel à l'autre (docblock de `startCurrentStream`).
            if (mode !== 'partial') {
                ctx.ui.streamStates.isMuted = false
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
     * Un départ ne vaut que pour SON appel : celui qui porte la room d'un autre est
     * ignoré, en entier — des raccrochés croisés suivis d'un rappel immédiat livrent le
     * signal du premier appel pendant le second, avec le même pair. Sans room d'appel
     * (IDLE, mode `stream` : seul ce fichier y pose une valeur), rien à comparer.
     *
     * @returns {boolean} true si la séquence a été exécutée (false = ignorée)
     */
    const handleRemoteDeparture = async ({ userSlug, type, roomId }) => {
        if (!userSlug || !isValidSlug(userSlug)) return false

        const currentCallRoomId = ctx.session.currentCallRoomId
        if (currentCallRoomId && roomId && roomId !== currentCallRoomId) {
            console.warn(
                '[useCallManager] départ portant la room d\'un autre appel — ignoré',
                { userSlug, roomId, currentCallRoomId, contextId: ctx.contextId },
            )
            return false
        }

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
        ctx.session.establishedCallRoomId = null
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
        isCallEstablished,

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
