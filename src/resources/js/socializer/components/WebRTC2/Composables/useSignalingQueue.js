/**
 * 📡 useSignalingQueue (Signaling Layer)
 *
 *  point d'entrée unique des signaux de signalisation serveur
 *
 * 👉 gère :
 * - l'observation de la file de signaux de la room (ctx.lastRoomSignal)
 * - le routage type de signal → handler, via la table `routes` injectée
 * - la traçabilité : aucun signal n'est abandonné sans log
 *
 * 👉 utilise (par injection, jamais par import) :
 * - une table `routes` : { TYPE_DE_SIGNAL: handler }, construite par l'orchestrateur
 *   (seul endroit autorisé à mixer les couches)
 *
 * 👉 ne connaît PAS :
 * - QUI traite un signal : elle ne voit que des handlers opaques. C'est ce qui lui
 *   permet d'être instanciée au-dessus de toutes les couches sans cycle
 * - l'émission des signaux (usePeerCore fait les POST) ni leur production
 *   (components/System/Notifications.vue mappe les events Reverb → dispatchSignal)
 *
 * 👉 rôle :
 * - source de vérité unique du routage des signaux entrants ; remplace les deux
 *   watchers + switch qui vivaient dans usePeerCore et usePeerConnections, et la
 *   table SIGNAL_TYPES qui dédoublait ce routage
 *
 * 🔒 La table `routes` est le seul catalogue des types de signaux acceptés : un type
 *    sans handler est loggué, jamais avalé en silence.
 *
 * 🔒 Le routage ne pose AUCUNE précondition et n'attend rien : il appelle le handler
 *    dans le flush du watcher. Les préconditions (peerId local prêt, stream disponible)
 *    appartiennent aux handlers et au moteur de retry, qui savent réessayer — alors
 *    qu'un signal abandonné ici l'est définitivement (`PEER_CONNECT_TO_REMOTE_PEER`
 *    n'est jamais re-livré par l'émetteur).
 *
 * ⚠️ La file du store (peerStore.signalQueues) porte DEUX conventions d'enveloppe :
 *    - `{ roomId: '<type>-<room>', type, payload }` — signaux serveur, scopés sur
 *      ctx.contextId : la seule que cette couche traite ;
 *    - `{ roomId: '<peerId PeerJS>', payload: { type, ... } }` — signaux datachannel
 *      des Widgets (AUDIO_MUTE_TOGGLE…), consommés par
 *      Widgets/Mediaplayer/Composables/useRemotePeerState.js. Ce sont des projections
 *      d'état : elles restent hors de ce routage.
 *
 * ⚠️ « Dernière valeur gagne » est vrai PAR CLÉ DE FILE, et la clé de ces projections est
 *    le peerId — pas le type. Les deux pistes d'un même pair partagent donc un seul
 *    emplacement : un AUDIO_MUTE_TOGGLE suivi d'un VIDEO_ACTIVE_TOGGLE dans le MÊME tick
 *    perd le premier. Mesuré, et épinglé comme statu quo par un cas de
 *    `__tests__/useRemotePeerState.test.js` — ce cas rougira le jour où la file sera
 *    drainée par type, et se supprimera avec ce correctif-là.
 *
 * ⚠️ La consommation reste « dernier signal de la room » (ctx.lastRoomSignal), pas un
 *    drain de la file : deux signaux dispatchés dans le même tick n'en déclenchent
 *    qu'un. Aucun chemin actuel ne produit ça (un event Reverb = une frame WS = une
 *    tâche de boucle d'événement, et un seul producteur : Notifications.vue), mais la
 *    sémantique est désormais **instrumentée** : `dispatchSignal` estampille chaque
 *    signal d'un `seq` monotone par room et `_route` loggue tout trou dans la suite.
 *    Le drain (curseur, drain sérialisé, garde de ré-entrance, rewind) reste conditionné
 *    à ce warn — voir TODOLIST.md (« Drainer réellement la file de signaux »).
 */

import { watch, onUnmounted } from 'vue'

export function useSignalingQueue(ctx, { routes = {} } = {}) {

    // Garde d'arrêt définitif : couvre le cas d'un routage déjà en vol (await) au
    // moment où stopSignaling() est appelé — unwatch() n'annule pas un callback parti.
    let _stopped = false

    // Dernier `seq` observé pour cette room (null = pas encore initialisé) : sert
    // uniquement au détecteur de coalescence, jamais au routage lui-même.
    let _lastSeq = null

    /**
     * Détecte un signal perdu par la sémantique « dernier signal gagne ».
     * Le compteur avance sur TOUT signal observé — y compris ceux qu'on n'arrive pas à
     * router (type inconnu, enveloppe sans type) : sinon le trou deviendrait permanent
     * et chaque signal suivant serait signalé à tort.
     * @param {Object} signal - Enveloppe { roomId, type, payload, ts, seq }
     */
    const _checkSequence = (signal) => {
        // Tolère l'absence de seq : enveloppes poussées hors de dispatchSignal.
        if (typeof signal.seq !== 'number') return

        const missing = _lastSeq === null ? 0 : signal.seq - _lastSeq - 1

        if (missing > 0) {
            // Les entrées manquantes sont encore dans la file au moment du log (plafond
            // de 10 par room) : on les nomme quand le store le permet, sinon on se
            // contente du compte.
            const queue = ctx.peerStore?.getQueueForRoom?.(ctx.contextId) ?? []
            const lost = queue
                .filter(s => s?.seq > _lastSeq && s.seq < signal.seq)
                .map(s => s.type ?? '?')
                .join(', ')

            console.warn(
                `[useSignalingQueue] ${missing} signal(s) non routé(s) (seq ${_lastSeq + 1}→${signal.seq - 1})`
                + (lost ? ` : ${lost}` : '')
                + ' — coalescence dans le même tick, cf. TODOLIST « Drainer réellement la file de signaux »'
            )
        }

        if (_lastSeq === null || signal.seq > _lastSeq) {
            _lastSeq = signal.seq
        }
    }

    /**
     * Route un signal entrant vers son handler.
     * @param {Object} signal - Enveloppe { roomId, type, payload, ts, seq }
     * @returns {Promise<void>}
     */
    const _route = async (signal) => {
        // Ceinture : après stopSignaling() le watcher est déjà coupé, donc ce cas ne peut
        // survenir que pour un callback déjà en file d'attente au moment de l'arrêt.
        if (_stopped) return

        // File vidée en pleine session (clearSignalQueueRoom, appelé par stopWebcamStream
        // et stopCallWithPeers alors que le watcher tourne encore) : lastRoomSignal
        // repasse à null. Ce n'est pas un signal abandonné, ne pas le warner.
        if (!signal) {
            console.debug('[useSignalingQueue] file de signaux vidée')
            return
        }

        _checkSequence(signal)

        if (!signal.type) {
            // Enveloppe des Widgets (type dans `payload.type`, scopée sur un peerId) :
            // légitimement hors de ce routage, cf. l'avertissement en tête de fichier.
            if (signal.payload?.type) {
                console.debug('[useSignalingQueue] enveloppe datachannel ignorée', signal.payload.type)
            } else {
                console.warn('[useSignalingQueue] signal sans type — abandonné', signal)
            }
            return
        }

        const handler = routes[signal.type]
        if (typeof handler !== 'function') {
            console.warn(`[useSignalingQueue] aucun handler pour le signal "${signal.type}"`)
            return
        }

        // ⚠️ AUCUNE précondition asynchrone ici — volontairement.
        // Une version précédente attendait `ctx.waitForMeReady()` avant d'appeler le
        // handler : sur une identité locale momentanément indisponible (peer en cours de
        // recréation, `lastLocalPeerId` remis à null par `_destroyPeerSingleton`), le
        // signal était retardé de 15 s puis ABANDONNÉ. Or `PEER_CONNECT_TO_REMOTE_PEER`
        // n'est jamais re-livré : c'est ce qui empêchait un arrivant de voir un flux
        // existant, de façon intermittente. Les préconditions appartiennent aux
        // handlers (garde d'identité publiable de responseRemotePeerConnection) et au moteur
        // de retry du pool, qui savent réessayer. Router doit rester synchrone.
        console.debug(`[useSignalingQueue] signal routé: ${signal.type}`)

        try {
            await handler(signal.payload)
        } catch (e) {
            console.error(`[useSignalingQueue] handler "${signal.type}" a échoué:`, e)
        }
    }

    const unwatchSignals = watch(ctx.lastRoomSignal, _route)

    /**
     * Arrête l'observation des signaux. Idempotent.
     * Appelé en tête du cleanup explicite de l'orchestrateur (cleanupPeerConnection) :
     * plus aucun signal ne doit être routé une fois le teardown commencé.
     */
    const stopSignaling = () => {
        if (_stopped) return
        _stopped = true
        unwatchSignals()
    }

    // Filet de sécurité si le composant est détruit sans cleanup explicite.
    onUnmounted(stopSignaling)

    return {
        stopSignaling,
    }
}
