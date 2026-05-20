/**
 * 🔗 usePeerConnections (Connection Layer)
 * 
 *  ouverture, synchronisation et gestion des connexions
 *
 * 👉 gère :
 * - ouverture et fermeture des connexions PeerJS
 * - gestion des appels (peer.call, peer.connect)
 * - réception des streams distants
 * - synchronisation des connexions entre utilisateurs
 *
 * 👉 utilise :
 * - les streams fournis par usePeerMedia
 *
 * 👉 ne gère PAS :
 * - création de MediaStream
 * - logique UI
 *
 * 👉 rôle :
 * - orchestrer le réseau WebRTC entre les peers
 * 
 */
import { watch, markRaw, onUnmounted } from 'vue'
import { MAX_PEERS_PER_ROOM, VALID_CONNECTION_TYPES } from '../webrtc2.config.js'

export function usePeerConnections(ctx) {

    const inFlightConnections = new Set()

    // Mutex à chaîne de promesses : sérialise les appels concurrents à getRoomUsersDiff
    // pour éviter le TOCTOU sur ctx.connection.usersInRoom (lecture puis écriture non atomiques).
    let _diffLock = Promise.resolve()

    const _doGetRoomUsersDiff = async (users = []) => {
        const ready = await ctx.waitForMeReady()
        if (!ready) {
            return { newUsers: [], removedUsers: [] }
        }

        const usersInRoom = users.filter(user => user.slug !== ctx.meStore.getMe.slug)
        const nextSlugs = usersInRoom.map(user => user.slug)
        const previousSlugs = [...ctx.connection.usersInRoom]

        const newUsers = usersInRoom.filter(user => !previousSlugs.includes(user.slug))
        const removedUsers = previousSlugs.filter(slug => !nextSlugs.includes(slug))

        ctx.connection.usersInRoom = nextSlugs

        return { newUsers, removedUsers }
    }

    const getRoomUsersDiff = (users = []) => {
        const current = _diffLock.then(() => _doGetRoomUsersDiff(users))
        // On absorbe l'erreur sur le verrou pour ne pas casser les appels suivants.
        _diffLock = current.catch(() => {})
        return current
    }

    const getNewUsersInRoom = async (users = []) => {
        const diff = await getRoomUsersDiff(users)
        return diff.newUsers
    }

    const hasOpenConnection = (userSlug, roomArg = null, typeArg = null) => {
        const room = roomArg || ctx.session.currentCallRoomId || ctx.session.currentRoom
        const type = typeArg || ctx.currentType.value
        const roomConnections = ctx.peerStore.getConnections?.[room]?.[userSlug]?.[type] ?? []

        if (!Array.isArray(roomConnections) || roomConnections.length === 0) {
        return false
        }

        return roomConnections.some((conn) => {
            if (!conn) return false

            // DataConnection PeerJS
            if (type === 'data') {
                return conn.open === true
            }

            // MediaConnection PeerJS — lecture défensive : le RTCPeerConnection peut être
            // en cours de destruction au moment de la lecture (TOCTOU inter-ticks).
            try {
                const pc = conn.peerConnection
                if (pc?.connectionState) {
                    return !['closed', 'failed', 'disconnected'].includes(pc.connectionState)
                }

                if (pc?.signalingState) {
                    return pc.signalingState !== 'closed'
                }
            } catch {
                // Objet RTCPeerConnection détruit ou état illisible → connexion considérée fermée
                return false
            }

            // Fallback: connexion considérée active si non explicitement fermée
            return true
        })
    }  

    /**
     * Compte le nombre de peers ayant actuellement une connexion active dans une room
     * (pour le type donné). Utilisé pour enforcer MAX_PEERS_PER_ROOM.
     */
    const _countActivePeersInRoom = (room, type) => {
        const roomConnections = ctx.peerStore.getConnections?.[room]
        if (!roomConnections || typeof roomConnections !== 'object') return 0
        return Object.keys(roomConnections).filter(
            slug => hasOpenConnection(slug, room, type)
        ).length
    }

    const connectToPeer = (payload) => {
        const userSlug = payload?.userSlug || payload?.fromUserSlug
        const peerId = payload?.peerId ? String(payload.peerId) : null

        if (!userSlug || !peerId) {
            console.warn('Connexion peer ignorée: userSlug ou peerId manquant', payload)
            return false
        }

        const room = payload?.room || ctx.session.currentCallRoomId || ctx.session.currentRoom
        const type = payload?.type || ctx.currentType.value

        const mySlug = ctx.meStore.getMe?.slug
        const myPeerId = String(
            ctx.peerStore.getLocalPeerId
            || ''
        )

        // Garde 1: ne jamais se connecter à soi-même
        if ((mySlug && userSlug === mySlug) || (myPeerId && peerId === myPeerId)) {
            return true
        }

        // Garde 2: évite les doubles tentatives concurrentes pour la même cible
        const lockKey = room + ':' + type + ':' + userSlug
        if (inFlightConnections.has(lockKey)) {
            return true
        }

        // Acquiert le verrou AVANT hasOpenConnection pour éviter le TOCTOU :
        // la vérification de l'état et l'action (peer.call/connect) sont dans la même
        // section critique — aucun appel concurrent ne peut passer la garde entre les deux.
        inFlightConnections.add(lockKey)

        try {
            // Garde 3 (dans le verrou) : vérifié après acquisition pour que l'état lu
            // et l'action qui suit soient atomiques vis-à-vis des appels concurrents.
            if (hasOpenConnection(userSlug, room, type)) {
                return true
            }

            // Garde 4 : limite du nombre de peers par room en topologie mesh.
            // Compté à l'intérieur du verrou pour que la lecture et la décision
            // soient atomiques vis-à-vis des appels concurrents.
            const activePeerCount = _countActivePeersInRoom(room, type)
            if (activePeerCount >= MAX_PEERS_PER_ROOM) {
                console.warn(
                    `[usePeerConnections] connectToPeer: limite de ${MAX_PEERS_PER_ROOM} peers` +
                    ` atteinte pour la room "${room}" (type: ${type})` +
                    ` — connexion vers "${userSlug}" refusée`,
                    { activePeerCount, room, type, userSlug }
                )
                return false
            }

            // On supprime le waiting flag seulement quand on a une cible exploitable
            if (ctx.peerStore.hasWaitingRemotePeerId(userSlug)) {
                ctx.peerStore.removeWaitingRemotePeerId(userSlug)
            }

            if (!ctx.peerStore.hasRemotePeerId(userSlug)) {
                ctx.peerStore.addRemotePeerId(userSlug, peerId)
            }

            const config = _buildPeerConnectionConfig({
                ...payload,
                userSlug,
                peerId,
                type,
                room,
            })

            if (!config) {
                return false
            }

            if (config.options.metadata.type === 'data') {
                const conn = ctx.peerStore.getLocalPeer.connect(config.peerId, config.options)
                _saveRoomConnection(config, conn)
                return true
            }

            if (config.options.metadata.type === 'stream') {
                const stream = config.stream
                const isValidStream = stream instanceof MediaStream
                    && stream.getTracks().some(t => t.readyState === 'live')
                // Pas de stream disponible : pas encore streamé, on ignore silencieusement
                if (!isValidStream) {
                    return true
                }
                const call = ctx.peerStore.getLocalPeer.call(config.peerId, stream, config.options)
                _saveRoomConnection(config, call)
                return true
            }

            if (config.options.metadata.type === 'screen') {
                const stream = config.stream
                const isValidStream = stream instanceof MediaStream
                    && stream.getTracks().some(t => t.readyState === 'live')
                if (!isValidStream) return true
                const call = ctx.peerStore.getLocalPeer.call(config.peerId, stream, config.options)
                _saveRoomConnection(config, call)
                return true
            }

            if (config.options.metadata.type === 'visio') {
                const stream = config.stream
                const isValidStream = stream instanceof MediaStream
                    && stream.getTracks().some(t => t.readyState === 'live')
                if (!isValidStream) {
                    console.warn('[usePeerConnections] connectToPeer (visio): stream local absent ou invalide — peer.call() annulé', {
                        userSlug,
                        stream: stream ?? null,
                    })
                    return false
                }
                const call = ctx.peerStore.getLocalPeer.call(config.peerId, stream, config.options)
                _saveRoomConnection(config, call)
                return true
            }

            return true
            
        } catch (error) {
            if (type === 'visio') {
                console.error('Erreur pendant connectToPeer (visio)', error)
            } else if (type === 'stream') {
                console.error('Erreur pendant connectToPeer (stream)', error)
            } else {
                console.error('Erreur pendant connectToPeer', error)
            }
            return false
        } finally {
            inFlightConnections.delete(lockKey)
        }
    }

    const closePeerConnection = (params = {}) => {
        const currentType = params?.type || ctx.session.currentType
        const currentRoom = params?.room || ctx.session.currentCallRoomId || ctx.session.currentRoom
        const roomConnections = ctx.peerStore.getConnections?.[currentRoom]
        const clearSignalQueue = params?.clearSignalQueue !== false

        if (!roomConnections || typeof roomConnections !== 'object') {
            if (clearSignalQueue) {
                ctx.peerStore.clearSignalQueueRoom(ctx.contextId)
            }
            return
        }

        const targetUsers = Array.isArray(params?.users) && params.users.length > 0
            ? params.users
            : Object.keys(roomConnections)

        targetUsers.forEach((userSlug) => {
            ctx.peerStore.closePeerConnection(
                currentRoom,
                userSlug,
                currentType
            )
            ctx.peerStore.clearConnectionsRoom(currentRoom, userSlug, currentType)
            ctx.peerStore.removeRemotePeerId(userSlug)

            if (ctx.peerStore.hasWaitingRemotePeerId(userSlug)) {
                ctx.peerStore.removeWaitingRemotePeerId(userSlug)
            }
        })

        if (clearSignalQueue) {
            ctx.peerStore.clearSignalQueueRoom(ctx.contextId)
        }
    }

    const _buildPeerConnectionConfig = (payload) => {
        const peerId = payload?.peerId ? String(payload.peerId).trim() : ''
        const userSlug = payload?.userSlug ? String(payload.userSlug).trim() : ''
        const type = payload?.type ? String(payload.type).trim() : ''
        const room = payload?.room ? String(payload.room).trim() : ''
        const me = ctx.meStore.getMe

        if (!peerId) {
            console.warn('[usePeerConnections] _buildPeerConnectionConfig: peerId manquant ou vide', payload)
            return null
        }
        if (!userSlug) {
            console.warn('[usePeerConnections] _buildPeerConnectionConfig: userSlug manquant ou vide', payload)
            return null
        }
        if (!VALID_CONNECTION_TYPES.has(type)) {
            console.warn('[usePeerConnections] _buildPeerConnectionConfig: type de connexion invalide', { type, validTypes: [...VALID_CONNECTION_TYPES] })
            return null
        }
        if (!room) {
            console.warn('[usePeerConnections] _buildPeerConnectionConfig: room manquante ou vide', payload)
            return null
        }
        if (!me?.slug) {
            console.warn('[usePeerConnections] _buildPeerConnectionConfig: meStore.getMe null ou slug absent')
            return null
        }

        const config = {
            peerId,
            options: {
                metadata: {
                    slug: userSlug,
                    from: String(me.slug),
                    fromName: String(me.name ?? ''),
                    type,
                    room,
                    callbackKey: ctx.contextId,
                }
            }
        }

        if (type === 'data') {
            // Whether the underlying data channels should be reliable (e.g. for large file transfers)
            // or not (e.g. for gaming or streaming).
            config.options.reliable = true
        } else if (type === 'screen') {
            config.stream = ctx.media.screenStream
        } else if (
            type === 'stream'
            || type === 'visio'
            || type === 'vocal'
        ) {
            config.stream = ctx.media.currentStream
        }

        return config
    }

    const _saveRoomConnection = (config, connection) => {
        ctx.peerStore.prepareRoomConnection(config)
        ctx.setUpConnectionListeners(connection)
        _storeRoomConnection(config, markRaw(connection))
    }

    const _storeRoomConnection = (config, connection) => {
        ctx.peerStore.storePeerConnection(
            config.options.metadata.room,
            config.options.metadata.slug,
            config.options.metadata.type,
            connection
        )
    }

    const stopSignalWatch = watch(ctx.lastRoomSignal, async (signal) => {
        if (!signal || !ctx.SIGNAL_TYPES.connections.includes(signal.type)) return

        switch (signal.type) {
            case 'PEER_CONNECT_TO_REMOTE_PEER':
                await connectToPeer(signal.payload)
                break
        }
    })

    onUnmounted(() => {
        stopSignalWatch()
    })

    return {
        getNewUsersInRoom,
        getRoomUsersDiff,
        hasOpenConnection,
        connectToPeer,
        closePeerConnection,
    }
}