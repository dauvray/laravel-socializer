/**
 * 🔗 useConnectionPool (Connection Layer)
 *
 *  établissement et maintien des connexions pair-à-pair d'une room
 *
 * 👉 gère :
 * - le moteur de retry des connexions (instance dédiée de usePeerRetry)
 * - la décision « demander un peerId » vs « ouvrir la connexion »
 * - la recovery sur peer indisponible (watch de ctx.peerUnavailableSignal)
 * - la synchronisation room → connexions (diff des users, fan-out mesh / star)
 *
 * 👉 utilise (par injection, jamais par import) :
 * - usePeerCore (signalisation), usePeerConnections (connexions PeerJS)
 *
 * 👉 ne connaît PAS :
 * - la logique d'appel (invite / accept / raccroché) → useCallManager
 * - les streams et le DOM → usePeerMedia
 * - l'orchestrateur : aucune couche supérieure ne lui est injectée
 *
 * 👉 rôle :
 * - socle de connexion sur lequel s'appuient les couches appels et streams
 */

import { ref, watch, onUnmounted } from 'vue'
import { usePeerRetry } from '~socializer/components/WebRTC2/Composables/utils/usePeerRetry.js'
import { isValidSlug } from '~socializer/components/WebRTC2/Composables/utils/validators.js'
import { SIGNALING_STALE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

export function useConnectionPool(ctx, { core, connections }) {

    const syncUsersConnectionsLock = ref(false)

    // Moteur de retry des connexions, propriété du pool.
    // (usePeerCore garde le sien, dédié aux invitations d'appel.)
    const retryManager = usePeerRetry(ctx)

    /**
     * Le flux exigé par ce type de connexion est-il réellement émettable ?
     *
     * Réplique la précondition de `usePeerConnections.connectToPeer`, qui pour `stream`
     * et `screen` sort par un `return true` **sans rien ouvrir** quand le flux local
     * n'est pas (encore) valide. Vu du moteur de retry, ce `true` est ambigu : il dit
     * « pas d'erreur », pas « connexion établie ». Ce prédicat lève l'ambiguïté sans
     * changer le contrat de connectToPeer, en distinguant « rien à envoyer, abandonner »
     * de « pas encore prêt, réessayer ».
     *
     * @param {string} type
     * @returns {boolean}
     */
    const _canEmitStreamFor = (type) => {
        // Un data channel n'a aucun flux à porter : toujours émettable.
        if (type === 'data') return true

        const stream = type === 'screen' ? ctx.media.screenStream : ctx.media.currentStream
        return stream instanceof MediaStream
            && stream.getTracks().some(track => track.readyState === 'live')
    }

    /**
     * LOGIQUE DE TENTATIVE (Callback pour le RetryManager)
     * Détermine si on doit continuer à essayer de se connecter à un user.
     */
    const _handleConnectionAttempt = async (userSlug) => {
        // 🛑 Ne relance RIEN si on est en train d'arrêter
        if (ctx.isShuttingDown.value) return true

        const room = ctx.session.currentCallRoomId || ctx.currentRoom.value
        const mainTypeOpen = connections.hasOpenConnection(userSlug, null, ctx.currentType.value)
        const screenOpen = !ctx.media.isCapturing
            || connections.hasOpenConnection(userSlug, null, 'screen')

        // 1. Succès ultime : connexion établie
        if (mainTypeOpen && screenOpen) return true

        const remotePeerId = ctx.peerStore.getRemotePeerId(userSlug)
        const waiting = ctx.peerStore.getWaitingRemotePeerId(userSlug)

        // 2. Sécurité : Si on n'a plus d'ID ET plus d'intention (waiting), l'user est vraiment parti.
        if (!remotePeerId && !waiting) return true

        // 3. Si on a un ID, on tente la connexion (même si waiting a sauté)
        if (remotePeerId) {
            // ⚠️ Les deux tentatives sont INDÉPENDANTES : ne jamais sortir entre les deux.
            // Le type principal et le partage d'écran partagent la même chaîne de retry
            // (usePeerRetry._retryKey ne discrimine pas le type), donc un `return`
            // prématuré ici condamne l'autre tentative avec lui. Le cas critique est
            // l'écran : `requestRemotePeerConnection` envoie toujours `type: currentType`,
            // jamais `'screen'` — ce moteur est donc le SEUL à ouvrir la connexion d'écran
            // vers un arrivant. Un `return` avant la branche ci-dessous et le partage
            // d'écran n'atteint jamais personne (symptôme observé : « aléatoire », parce
            // que ça ne cassait que si A n'avait pas aussi un flux webcam actif).
            // On accumule donc l'état et on ne décide qu'à la fin.
            let settled = true

            if (!mainTypeOpen) {
                const connected = connections.connectToPeer({
                    userSlug,
                    peerId: remotePeerId,
                    type: ctx.currentType.value,
                    room,
                })

                // Deux raisons distinctes de différer :
                // - `connected === false` : échec réel (ex: visio sans flux prêt)
                // - `connected === true` mais rien d'ouvert : pour `stream`/`screen`,
                //   connectToPeer sort par true sans rien ouvrir quand le flux local n'est
                //   pas encore valide. Conclure ici **annulait** le retry au lieu de le
                //   différer, et la connexion n'était plus jamais rouverte une fois le flux
                //   prêt.
                if (!connected || !_canEmitStreamFor(ctx.currentType.value)) settled = false
            }

            if (ctx.media.isCapturing && !screenOpen) {
                const connected = connections.connectToPeer({
                    userSlug,
                    peerId: remotePeerId,
                    type: 'screen',
                    room,
                })

                if (!connected || !_canEmitStreamFor('screen')) settled = false
            }

            // `false` = « rien n'est encore conclu, redemander plus tard ». Quand A ne
            // partage QUE son écran, le type principal n'aura jamais de flux : le retry
            // ira donc jusqu'à MAX_RETRY_ATTEMPTS puis abandonnera avec un warn, alors que
            // la connexion d'écran est établie depuis longtemps. Borné et sans conséquence
            // fonctionnelle. Distinguer « n'aura jamais de flux » de « pas encore de flux »
            // n'est pas décidable ici — cf. l'item TODOLIST sur le type envoyé par
            // requestRemotePeerConnection.
            return settled
        }

        // 4. Signalisation stale : On ne demande l'ID que si on est toujours en attente (waiting)
        if (waiting) {
            const age = Date.now() - (waiting.createdAt ?? 0)
            if (age >= SIGNALING_STALE_MS) {
                // On redemande pour ce qui manque réellement — y compris l'écran, dont
                // c'était jusqu'ici le seul chemin d'ouverture possible.
                if (!mainTypeOpen) core.requestRemotePeerConnection(userSlug, ctx.currentType.value)
                if (ctx.media.isCapturing && !screenOpen) core.requestRemotePeerConnection(userSlug, 'screen')
            }
        }

        return false
    }

    /**
     * Tente de se connecter à un peer distant ou de demander une connexion si nécessaire.
     *
     * @param {string} userSlug - L'identifiant de l'utilisateur pour lequel la connexion est tentée.
     * @param {string|null} type - Type de connexion (défaut : type courant du contexte).
     * @returns {void}
     */
    const requestOrConnectPeer = (userSlug, type = null) => {
        if (!userSlug) return
        const effectiveType = type || ctx.currentType.value
        if (connections.hasOpenConnection(userSlug, null, effectiveType)) return

        const remotePeerId = ctx.peerStore.getRemotePeerId(userSlug)
        const waiting = ctx.peerStore.getWaitingRemotePeerId(userSlug)

        if (remotePeerId) {
            connections.connectToPeer({
                userSlug,
                peerId: remotePeerId,
                type: effectiveType,
                room: ctx.session.currentCallRoomId || ctx.currentRoom.value,
            })
        } else if (!waiting) {
            // On ne demande que si on n'est pas déjà en train d'attendre.
            // ⚠️ Le type est transmis : sans lui, une demande pour 'screen' repartait
            // avec le type du contexte et la connexion d'écran n'était jamais ouverte
            // par la signalisation (seul le moteur de retry le faisait, ~1,5 s plus tard).
            core.requestRemotePeerConnection(userSlug, effectiveType)
        }

        // On lance le moteur de retry (qui surveillera l'évolution vers 'open')
        retryManager.scheduleRetry(userSlug, 0, _handleConnectionAttempt)
    }

    // ── Recovery watch : peer-unavailable ──────────────────────────────────────
    // usePeerTransport écrit le slug du peer indisponible dans ctx.peerUnavailableSignal.
    // On observe ce signal ici (watch réactif) pour relancer le cycle de connexion.
    // Plus propre que la mutation implicite de hooks.onPeerUnavailable.
    // ─────────────────────────────────────────────────────────────────────────
    const unwatchPeerUnavailable = watch(ctx.peerUnavailableSignal, (userSlug) => {
        if (!userSlug) return
        if (ctx.isShuttingDown.value) return
        if (!isValidSlug(userSlug)) return
        requestOrConnectPeer(userSlug)
        // On remet le signal à null pour pouvoir détecter une prochaine émission
        // (watch ne se re-déclenche pas si la valeur ne change pas).
        ctx.peerUnavailableSignal.value = null
    })

    /**
     * Synchronise les connexions avec la liste des utilisateurs présents dans la room.
     * @param {Array} users - Liste des utilisateurs (objets avec un slug) présents dans la room.
     */
    const syncUsersConnections = async (users) => {
        if (!Array.isArray(users)) return

        if (syncUsersConnectionsLock.value) {
            return
        }

        syncUsersConnectionsLock.value = true

        try {

            // on attend d’avoir les infos de contexte nécessaires (meStore ready) avant de faire quoi que ce soit.
            const ready = await ctx.waitForMeReady()
            if (!ready) {
                return
            }

            const { newUsers, removedUsers } = await connections.getRoomUsersDiff(users)

            // Nettoyage des peers qui ne sont plus dans la room.
            removedUsers.forEach(userSlug => {
                const activeRoom = ctx.session.currentCallRoomId || ctx.currentRoom.value
                retryManager.clearRetry(userSlug)
                ctx.peerStore.removeWaitingRemotePeerId(userSlug)
                ctx.peerStore.removeRemotePeerId(userSlug)
                ctx.peerStore.clearConnectionsRoom(activeRoom, userSlug, ctx.currentType.value)

                // Fermer aussi la connexion 'screen' si elle existe
                if (ctx.media.isCapturing) {
                    ctx.peerStore.clearConnectionsRoom(activeRoom, userSlug, 'screen')
                }
            })

            // Mesh: tout le monde se connecte à tout le monde.
            if (ctx.topology.value === 'mesh') {
                newUsers.forEach(user => {
                    requestOrConnectPeer(user.slug)

                    // Si on est en train de partager l'écran, initier aussi la connexion 'screen'
                    if (ctx.media.isCapturing) {
                        requestOrConnectPeer(user.slug, 'screen')
                    }
                })
            }
            // Star: le hub se connecte à tout le monde, les clients seulement au hub.
            else if (ctx.topology.value === 'star' && ctx.hubSlug.value) {
                if (ctx.isHub.value) {
                    newUsers.forEach(user => {
                        requestOrConnectPeer(user.slug)
                    })
                } else {
                    requestOrConnectPeer(ctx.hubSlug.value)
                }
            }
            // SFU: pas de maillage pair à pair côté client.

        } finally {
            syncUsersConnectionsLock.value = false
        }
    }

    /**
     * Arrête l'observation et libère les timers de retry.
     * Appelé par l'orchestrateur lors d'un cleanup explicite (cleanupPeerConnection).
     */
    const stopPool = () => {
        unwatchPeerUnavailable()
        retryManager.clearAll()
    }

    // Filet de sécurité : stoppe le watcher et les timers de retry si le composant
    // est détruit sans que cleanupPeerConnection() ait été appelé explicitement
    // (navigation abrupte, erreur, lazy-unmount, etc.).
    // ⚠️ NE PAS appeler cleanupPeerConnection() ici : createPeerContext.destroy()
    // s'exécute en premier (FIFO) et vide la session, ce qui rendrait
    // connections.closePeerConnection() inefficace.
    onUnmounted(() => {
        ctx.beginShutdown()   // 🛑 Bloque tout retry post-unmount
        stopPool()            // Arrête l'observation du signal + libère les timers en vol
    })

    return {
        requestOrConnectPeer,
        syncUsersConnections,
        clearRetry: retryManager.clearRetry,
        clearAllRetries: retryManager.clearAll,
        stopPool,

        /*---------------------------------
        | ÉTAT INTERNE (observable / debug)
        ----------------------------------*/
        syncUsersConnectionsLock,
    }
}
