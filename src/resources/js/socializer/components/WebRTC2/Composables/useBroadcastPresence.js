/**
 * 📢 useBroadcastPresence (Presence Layer)
 *
 *  un fait métier — « je diffuse / je ne diffuse plus » — et DEUX transports
 *
 * 👉 gère :
 * - l'émission du signal `BROADCAST_STATE` (changement d'état local, et à l'ouverture
 *   de chaque connexion data — c'est ce second point qui informe les arrivants)
 * - la réception de ce signal et l'écriture dans `ctx.media.announcedStreamsMap`
 * - l'enregistrement de l'état de diffusion embarqué sur les signaux de signalisation
 *   serveur (`noteBroadcastFromSignal`), qui n'exige aucun contact P2P
 * - l'émission et la réception du whisper de présence, le seul transport qui n'emprunte
 *   RIEN à la signalisation P2P (cf. « Pourquoi un second transport » ci-dessous)
 * - la purge des annonces des pairs qui ont quitté la room
 *
 * 👉 utilise (par injection, jamais par import) :
 * - usePeerTransport (émission + joignabilité data)
 * - le canal de présence Reverb, optionnel (`reverb`) : un hôte qui ne le fournit pas
 *   garde exactement le comportement d'avant ce transport
 *
 * 👉 ne connaît PAS :
 * - l'UI d'attente (`useAwaitedStreams` lit la projection `announcedStreamPeers`)
 * - l'orchestrateur : aucune couche supérieure ne lui est injectée
 *
 * 👉 rôle :
 * - remplacer l'heuristique « tout pair présent sans flux est attendu » par un FAIT :
 *   un pair est attendu parce qu'il a annoncé diffuser. Un pair silencieux n'est plus
 *   jamais attendu, donc plus de vignette d'attente quand personne ne diffuse.
 *
 * ⚠️ POURQUOI CE N'EST PAS DANS LA TABLE `routes` DE useSignalingQueue (contrairement
 * à ce que suggérait la TODOLIST) : cette table ne route que les enveloppes de
 * signalisation **serveur**, scopées sur `ctx.contextId`. `BROADCAST_STATE` voyage sur
 * le data channel, dont les enveloppes sont scopées sur un peerId et explicitement
 * hors de ce routage (cf. l'en-tête de useSignalingQueue). Il est donc traité au même
 * étage que les autres signaux datachannel — mais côté infra plutôt que dans chaque
 * app : l'interception se fait dans le wrap `onDataReceived` de l'orchestrateur, si
 * bien qu'aucun consommateur n'a de câblage à faire, et qu'un pair ne peut pas
 * l'injecter dans le flux métier (chat).
 *
 * ⚠️ LIMITE ASSUMÉE — le canal doit exister. En contexte `stream`, la connexion data
 * est ouverte par `connectToPeer` **en même temps** que l'appel média, et seulement si
 * un flux local est valide : l'annonce ne peut donc pas arriver avant que le pair ait
 * commencé à diffuser (ce qui est exactement ce qu'on veut), mais elle n'arrive pas non
 * plus plus tôt que l'appel. Le filet qui couvre la fenêtre « A diffuse déjà, B arrive »
 * est la trace de l'appel entrant, écrite par `usePeerTransport` dans le même registre
 * (`peer.on('call')` se déclenche dès la réception de l'offre, avant ICE).
 *
 * La fenêtre d'AVANT tout contact P2P — échange de peerId + backoff — est couverte depuis
 * que les deux routes de peerId embarquent `isBroadcasting` (`noteBroadcastFromSignal`
 * ci-dessous).
 *
 * ⚠️ POURQUOI UN SECOND TRANSPORT (whisper de présence, 28/08/2026). Les trois chemins
 * data/signalisation partagent une limite structurelle : ils ne disent rien quand il n'y a
 * rien à demander. `useConnectionPool.requestOrConnectPeer` ne poste sur les routes de
 * peerId que si le peerId distant n'est PAS déjà connu sous bail — cas nominal d'une
 * navigation SPA à l'intérieur de `REMOTE_PEER_ID_LEASE_MS`, donc cas MAJORITAIRE à
 * l'usage. Un arrivant qui possède déjà le peerId du diffuseur se connecte directement,
 * sans POST, donc sans porteur ; et en contexte `stream` un non-diffuseur n'ouvre pas de
 * canal data, ce qui ferme aussi `BROADCAST_STATE`. Mesuré : vignette à 8,8 s, ou jamais.
 *
 * Le whisper est le seul porteur INDÉPENDANT de la signalisation P2P — un saut WebSocket
 * sur un canal déjà rejoint et déjà autorisé. Il ferme du même geste le client non-hub en
 * star, qui ne demande jamais le peerId d'un diffuseur autre que le hub.
 *
 * Ce qu'il ne ferme pas : l'instant avant que `remotePeers` soit peuplé — le fait arrive,
 * mais `useAwaitedStreams` intersecte les annonces avec la composition de la room, écrite
 * après `waitForMeReady`. Borne d'AFFICHAGE, plus de porteur, et mesurée courte (592 ms).
 *
 * ⚠️ LIMITE ASSUMÉE — topologie star : le hub retransmet `envelope.payload` tel quel
 * (cf. `forwardStarMessage`), l'identité de l'émetteur d'origine est donc perdue pour
 * le destinataire final, qui attribuerait l'annonce au hub. On ne lit jamais l'identité
 * dans le payload (forgeable) : en star, seul le hub enregistre les annonces de ses
 * clients. Même limite que les autres signaux datachannel (AUDIO_MUTE_TOGGLE…).
 */

import { watch, onUnmounted } from 'vue'
import { resolveRemoteSlug } from '~socializer/components/WebRTC2/Composables/utils/resolveRemoteSlug.js'

/** Type du signal datachannel d'annonce de diffusion. */
export const BROADCAST_STATE = 'BROADCAST_STATE'

/**
 * Nom du client event Reverb portant la même annonce sur le canal de présence.
 *
 * Préfixé : le canal est partagé avec le métier de l'hôte (chat, indicateur de frappe),
 * et un nom nu comme `broadcast-state` finirait par collisionner.
 */
export const BROADCAST_STATE_WHISPER = 'webrtc2-broadcast-state'

export function useBroadcastPresence(ctx, { transport, reverb = null }) {

    // Webcam/audio OU partage d'écran : du point de vue du récepteur, « un flux de moi
    // est en route » ne se décline pas par type — la vignette d'attente est par pair.
    //
    // Le prédicat vit sur le contexte (`createPeerContext`) parce que `usePeerCore`
    // l'embarque aussi sur ses deux routes de peerId : deux copies divergeraient. Le verbe
    // reste ici, c'est lui que le reste du composable et ses tests consomment.
    const isBroadcasting = () => ctx.isBroadcasting.value === true

    /** Un seul warn par contexte : un whisper non attribué se répète à chaque annonce. */
    let _warnedUnattributed = false

    const _payload = () => ({
        roomId: ctx.session.onAirRoom,
        type: BROADCAST_STATE,
        isBroadcasting: isBroadcasting(),
    })

    /**
     * Diffuse l'état courant aux pairs joignables en data.
     *
     * On filtre sur la joignabilité AVANT d'appeler le transport : `sendData` loggue un
     * warn par destinataire injoignable, et le cas « aucun canal encore ouvert » est
     * normal ici (l'annonce part alors à l'ouverture, cf. announceBroadcastStateTo).
     *
     * @returns {boolean} true si l'annonce a été confiée au transport
     */
    const announceBroadcastState = () => {
        const reachable = transport.getDataReachablePeers()
        if (!reachable.length) return false

        // En star, le routage appartient au transport (enveloppe vers le hub) : lui
        // passer une liste de destinataires reviendrait à cibler le hub lui-même.
        const targets = ctx.topology.value === 'mesh' ? reachable : null
        transport.sendData(_payload(), targets)
        return true
    }

    /**
     * Annonce sur UNE connexion qui vient de s'ouvrir.
     *
     * C'est le chemin qui informe les arrivants : quand un pair rejoint la room alors
     * que je diffuse déjà, `syncUsersConnections` ouvre la connexion vers lui, et c'est
     * à cet instant précis — canal ouvert, donc envoi fiable — qu'il doit apprendre mon
     * état. Un `watch` sur `remotePeers` serait trop tôt (canal pas encore monté).
     *
     * Silencieux quand je ne diffuse pas : l'absence d'annonce vaut « pas de flux en
     * route », qui est l'état par défaut côté récepteur.
     *
     * @param {Object} conn  DataConnection PeerJS fraîchement ouverte
     * @returns {boolean}
     */
    const announceBroadcastStateTo = (conn) => {
        if (!isBroadcasting()) return false
        // `send` absent sur une MediaConnection : garde de type, pas de politesse.
        if (!conn || conn.open !== true || typeof conn.send !== 'function') return false

        try {
            conn.send(_payload())
        } catch (e) {
            console.warn('[useBroadcastPresence] annonce impossible sur la connexion ouverte', e)
            return false
        }
        return true
    }

    /**
     * Consomme un message entrant s'il s'agit d'une annonce de diffusion.
     *
     * @param {*} data       payload reçu sur le data channel
     * @param {Object} conn  connexion porteuse (source d'identité authentifiée)
     * @returns {boolean}    true si le message était une annonce (à ne pas remonter au métier)
     */
    const handleBroadcastStateMessage = (data, conn) => {
        if (!data || typeof data !== 'object' || data.type !== BROADCAST_STATE) return false

        // Identité résolue depuis la CONNEXION (authentifiée à l'admission), jamais
        // depuis le payload : `data.from` serait déclaratif, donc usurpable.
        const remoteSlug = resolveRemoteSlug(conn?.metadata, ctx.meStore.getMe?.slug)

        if (!remoteSlug) {
            console.warn('[useBroadcastPresence] annonce ignorée: pair distant non résolu', conn?.metadata)
            return true
        }

        // Star, côté client : une annonce arrivée PAR le hub a perdu son émetteur
        // d'origine (`forwardStarMessage` retransmet le payload nu). L'attribuer au hub
        // afficherait une vignette d'attente sur un pair qui ne diffuse pas — exactement
        // le faux positif qu'on supprime. On préfère ne rien afficher : conséquence
        // assumée, la diffusion du hub lui-même n'affiche pas de vignette chez ses
        // clients (elle n'est pas distinguable d'un relais).
        if (ctx.topology.value === 'star' && !ctx.isHub.value && remoteSlug === ctx.hubSlug.value) {
            return true
        }

        if (data.isBroadcasting) {
            ctx.markAnnouncedStream(remoteSlug, 'signal')
        } else {
            ctx.clearAnnouncedStream(remoteSlug)
        }

        return true
    }

    /**
     * Annonce mon état de diffusion sur le canal de présence Reverb.
     *
     * ⚠️ N'émet QUE quand je diffuse, et c'est le même contrat qu'`announceBroadcastStateTo` :
     * le silence vaut « pas de flux en route », qui est l'état par défaut côté récepteur.
     * Émettre un `false` ne servirait personne — la réception ne purge jamais (voir
     * `handleBroadcastStateWhisper`) — et donnerait à un membre hostile un moyen d'éteindre
     * une vignette vraie.
     *
     * La charge utile ne porte AUCUNE identité : le récepteur lit celle que Reverb pose sur
     * l'enveloppe. Elle porte en revanche `roomId`, car une page monte plusieurs contextes
     * sur UN seul canal (`Exemples/Home.vue` en monte trois).
     *
     * @returns {boolean} true si le whisper est parti
     */
    const announceBroadcastStateOnChannel = () => {
        if (!isBroadcasting()) return false
        if (typeof reverb?.whisper !== 'function') return false

        return reverb.whisper(BROADCAST_STATE_WHISPER, {
            roomId: ctx.session.onAirRoom,
            isBroadcasting: true,
        }) === true
    }

    /**
     * Consomme un whisper d'annonce reçu sur le canal de présence.
     *
     * ⚠️ L'identité vient de `metadata.user_id`, que **Reverb régénère** sur l'enveloppe à
     * partir de la connexion authentifiée (`ClientEvent`, sous
     * `accept_client_events_from: 'members'`) — jamais d'un champ de la charge utile, qui
     * serait déclaratif. C'est l'invariant n°1 du sens entrant (`securite.md`).
     *
     * ⚠️ **Fail-closed sur l'absence de `user_id`**, et ce n'est pas de la politesse : sous
     * `accept_client_events_from: 'all'`, Reverb retransmet l'événement BRUT — aucun contrôle
     * d'appartenance au canal, et un `user_id` que l'émetteur a pu écrire lui-même. Un
     * whisper non attribué par le serveur n'est donc pas « une annonce sans nom », c'est une
     * annonce dont le nom est celui que l'émetteur a choisi. On ne le lit pas.
     *
     * ⚠️ **Marque, ne purge JAMAIS**, comme `noteBroadcastFromSignal` : refuser la purge est
     * ce qui borne le pire cas d'un membre hostile à « faire apparaître une vignette de trop
     * pendant AWAITED_STREAM_TIMEOUT_MS », sans jamais pouvoir en supprimer une vraie.
     * L'arrêt de diffusion garde ses trois sorties (`handleRemoteDeparture`,
     * `BROADCAST_STATE: false`, filet du timeout).
     *
     * @param {Object} payload   { roomId, isBroadcasting }
     * @param {Object} metadata  { user_id } posé par Reverb
     * @returns {boolean} true si une annonce a été enregistrée
     */
    const handleBroadcastStateWhisper = (payload, metadata) => {
        if (payload?.isBroadcasting !== true) return false

        // Filtre de contexte : sur un canal partagé, l'annonce d'une autre room n'est pas
        // pour moi. Comparé à `onAirRoom` comme la charge utile datachannel.
        if (payload.roomId !== ctx.session.onAirRoom) return false

        const userId = metadata?.user_id

        if (userId === null || userId === undefined || userId === '') {
            if (!_warnedUnattributed) {
                _warnedUnattributed = true
                console.warn(
                    '[useBroadcastPresence] whisper d\'annonce ignoré : Reverb ne l\'a pas attribué. '
                    + 'Configurer `accept_client_events_from` à `members` (config/reverb.php) — '
                    + 'sous `all`, les client events sont retransmis bruts et non attribuables.'
                )
            }
            return false
        }

        // Annuaire écrit par le seul écrivain de `remotePeers`
        // (`usePeerConnections._doGetRoomUsersDiff`) : un `user_id` qui n'y est pas n'est
        // pas un membre observé de la room, et ne peut donc rien y annoncer.
        const remoteSlug = ctx.connection.slugByUserId.get(String(userId))

        if (!remoteSlug) return false

        return ctx.markAnnouncedStream(remoteSlug, 'presence') === true
    }

    /**
     * Enregistre l'état de diffusion embarqué sur un signal de signalisation SERVEUR
     * (`.AskToPeerID` / `.ResponseToPeerID`, cf. `usePeerCore`).
     *
     * C'est le seul des trois chemins d'annonce qui n'exige aucun contact P2P : il ferme la
     * fenêtre « A diffuse déjà, B arrive » entre l'entrée dans la room et le premier
     * `peer.call`, où B n'avait localement aucun moyen de savoir qu'un flux venait.
     *
     * ⚠️ **Marque, ne purge JAMAIS sur `false`.** `BROADCAST_STATE` peut purger : il voyage
     * sur un data channel ordonné, émis au changement d'état. Celui-ci est un instantané
     * embarqué sur un chemin HTTP + Reverb sans garantie d'ordre — un `false` en retard
     * effacerait une annonce vraie. L'arrêt de diffusion garde ses deux purges
     * (`handleRemoteDeparture`, `BROADCAST_STATE: false`) et le filet
     * `AWAITED_STREAM_TIMEOUT_MS`.
     *
     * L'identité vient de `fromUserSlug`, que le backend force à `Auth::user()->slug`
     * (invariant n°1 de la signalisation) — jamais d'un champ que l'émetteur choisit.
     *
     * @param {Object} payload  Enveloppe du signal { fromUserSlug, isBroadcasting, … }
     * @returns {boolean} true si une annonce a été enregistrée
     */
    const noteBroadcastFromSignal = (payload) => {
        if (payload?.isBroadcasting !== true) return false

        return ctx.markAnnouncedStream(payload.fromUserSlug, 'peer-id') === true
    }

    // Changement d'état local → annonce. Utile quand un canal data est déjà ouvert
    // (démarrage d'un partage d'écran pendant une diffusion webcam, arrêt de l'un des
    // deux). Au tout premier démarrage il n'y a encore aucun canal : l'annonce partira
    // à l'ouverture. À l'arrêt complet, les connexions du type sont fermées avant que
    // ce watch ne se déclenche — c'est la fermeture elle-même qui informe le récepteur
    // (handleRemoteDeparture purge l'annonce).
    const unwatchLocalState = watch(
        () => [ctx.media.isStreaming, ctx.media.isCapturing],
        () => {
            announceBroadcastState()
            // Le canal de présence, lui, n'attend rien : il porte l'annonce même s'il
            // n'existe aucune connexion data — c'est tout l'intérêt du second transport.
            announceBroadcastStateOnChannel()
        }
    )

    // Deux rôles sur un seul watch de la composition de la room, parce qu'il n'y a qu'un
    // seul fait à observer — « qui est là a changé » :
    //
    //  1. un pair qui QUITTE n'a plus rien en vol : sans cette purge, son annonce
    //     survivrait à son départ et le ferait attendre s'il revenait sans diffuser ;
    //  2. un pair qui ARRIVE n'a aucun moyen de connaître un état antérieur à son arrivée
    //     — un whisper ne s'historise pas. C'est donc au diffuseur de re-annoncer, et
    //     c'est CETTE branche qui ferme la fenêtre du peerId déjà connu sous bail.
    //
    // ⚠️ Un seul whisper par tour, jamais un par arrivant : la charge utile ne nomme
    // personne, elle diffuse à tout le canal. Trois arrivées simultanées, une annonce.
    const unwatchRoom = watch(
        () => [...(ctx.connection.remotePeers ?? [])],
        (slugs, previousSlugs) => {
            const present = new Set(slugs)
            for (const slug of [...ctx.media.announcedStreamsMap.keys()]) {
                if (!present.has(slug)) ctx.clearAnnouncedStream(slug)
            }

            const previous = new Set(previousSlugs ?? [])
            if (slugs.some((slug) => !previous.has(slug))) {
                announceBroadcastStateOnChannel()
            }
        }
    )

    // Abonné dès l'init, et pas à l'ouverture d'un canal data : le whisper doit pouvoir
    // arriver AVANT tout contact P2P, sinon il ne fermerait rien de plus que les autres.
    reverb?.listenForWhisper?.(BROADCAST_STATE_WHISPER, handleBroadcastStateWhisper)

    const stopBroadcastPresence = () => {
        unwatchLocalState()
        unwatchRoom()
        // ⚠️ Le callback est passé : plusieurs contextes partagent UN canal (trois dans
        // `Exemples/Home.vue`), et un désabonnement nu les rendrait tous sourds.
        reverb?.stopListeningForWhisper?.(BROADCAST_STATE_WHISPER, handleBroadcastStateWhisper)
    }

    onUnmounted(stopBroadcastPresence)

    return {
        isBroadcasting,
        announceBroadcastState,
        announceBroadcastStateTo,
        announceBroadcastStateOnChannel,
        handleBroadcastStateMessage,
        handleBroadcastStateWhisper,
        noteBroadcastFromSignal,
        stopBroadcastPresence,
    }
}
