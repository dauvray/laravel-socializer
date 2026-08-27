/**
 * 📢 useBroadcastPresence (Presence Layer)
 *
 *  annonce protocolaire « je diffuse / je ne diffuse plus » sur le data channel
 *
 * 👉 gère :
 * - l'émission du signal `BROADCAST_STATE` (changement d'état local, et à l'ouverture
 *   de chaque connexion data — c'est ce second point qui informe les arrivants)
 * - la réception de ce signal et l'écriture dans `ctx.media.announcedStreamsMap`
 * - l'enregistrement de l'état de diffusion embarqué sur les signaux de signalisation
 *   serveur (`noteBroadcastFromSignal`), qui n'exige aucun contact P2P
 * - la purge des annonces des pairs qui ont quitté la room
 *
 * 👉 utilise (par injection, jamais par import) :
 * - usePeerTransport (émission + joignabilité data)
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
 * ci-dessous) : elle ne l'était par aucun chemin, et le délai se lisait comme une panne.
 * Ce que ce troisième chemin ne couvre toujours pas : l'instant avant la PREMIÈRE demande
 * de peerId (`waitForMeReady`), et le client non-hub en topologie star, qui ne demande que
 * le hub.
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

export function useBroadcastPresence(ctx, { transport }) {

    // Webcam/audio OU partage d'écran : du point de vue du récepteur, « un flux de moi
    // est en route » ne se décline pas par type — la vignette d'attente est par pair.
    //
    // Le prédicat vit sur le contexte (`createPeerContext`) parce que `usePeerCore`
    // l'embarque aussi sur ses deux routes de peerId : deux copies divergeraient. Le verbe
    // reste ici, c'est lui que le reste du composable et ses tests consomment.
    const isBroadcasting = () => ctx.isBroadcasting.value === true

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
     * état. Un `watch` sur `usersInRoom` serait trop tôt (canal pas encore monté).
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
        () => { announceBroadcastState() }
    )

    // Un pair qui quitte la room n'a plus rien en vol : sans cette purge, son annonce
    // survivrait à son départ et le ferait attendre s'il revenait sans diffuser.
    const unwatchRoom = watch(
        () => [...(ctx.connection.usersInRoom ?? [])],
        (slugs) => {
            const present = new Set(slugs)
            for (const slug of [...ctx.media.announcedStreamsMap.keys()]) {
                if (!present.has(slug)) ctx.clearAnnouncedStream(slug)
            }
        }
    )

    const stopBroadcastPresence = () => {
        unwatchLocalState()
        unwatchRoom()
    }

    onUnmounted(stopBroadcastPresence)

    return {
        isBroadcasting,
        announceBroadcastState,
        announceBroadcastStateTo,
        handleBroadcastStateMessage,
        noteBroadcastFromSignal,
        stopBroadcastPresence,
    }
}
