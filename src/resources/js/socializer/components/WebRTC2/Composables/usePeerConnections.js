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
import { watch } from 'vue'

export function usePeerConnections(ctx) {

    const inFlightConnections = new Set()

    const getRoomUsersDiff = async (users = []) => {
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

            // MediaConnection PeerJS
            const pc = conn.peerConnection
            if (pc?.connectionState) {
                return !['closed', 'failed', 'disconnected'].includes(pc.connectionState)
            }

            if (pc?.signalingState) {
                return pc.signalingState !== 'closed'
            }

            // Fallback: connexion considérée active si non explicitement fermée
            return true
        })
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
            ctx.peerStore.localPeer?.id
            || ctx.peerStore.localPeer?._id
            || ctx.peerStore.lastLocalPeerId
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

        // Si la connexion avec ce type existe déjà et est ouverte, on ne recrée rien.
        if (hasOpenConnection(userSlug)) {
            return true
        }

        inFlightConnections.add(lockKey)

        try {
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

            if (config.options.metadata.type === 'data') {
                const conn = ctx.peerStore.getLocalPeer.connect(config.peerId, config.options)
                _saveRoomConnection(config, conn)
                return true
            }

            if (config.options.metadata.type === 'stream' && ctx.media.currentStream) {
                const call = ctx.peerStore.getLocalPeer.call(config.peerId, config.stream, config.options)
                _saveRoomConnection(config, call)
                return true
            }

            if (config.options.metadata.type === 'visio' && ctx.media.currentStream) {
                const call = ctx.peerStore.getLocalPeer.call(config.peerId, config.stream, config.options)
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
        const config = {
            peerId: String(payload.peerId),
            options: {
                metadata: {
                    slug: String(payload.userSlug),
                    from: String(ctx.meStore.getMe.slug),
                    fromName: String(ctx.meStore.getMe.name),
                    type: String(payload.type),
                    room: String(payload.room),
                    callbackKey: ctx.contextId,
                }
            }
        }

        if (payload.type === 'data') {
            // Whether the underlying data channels should be reliable (e.g. for large file transfers) 
            // or not (e.g. for gaming or streaming).
            config.options.reliable = true
        } else if ( payload.type === 'stream'
            || payload.type === 'screen'
            || payload.type === 'visio'
            || payload.type === 'vocal'           

        ) {
            config.stream = ctx.media.currentStream
        }

        return config
    }

    const _saveRoomConnection = (config, connection) => {
        ctx.peerStore.prepareRoomConnection(config)
        ctx.setUpConnectionListeners(connection)
        _storeRoomConnection(config, connection)
    }

    const _storeRoomConnection = (config, connection) => {
        ctx.peerStore.storePeerConnection(
            config.options.metadata.room,
            config.options.metadata.slug,
            config.options.metadata.type,
            connection
        )
    }

    watch(ctx.lastRoomSignal, async (signal) => {
        if (!signal || !ctx.SIGNAL_TYPES.connections.includes(signal.type)) return

        switch (signal.type) {
            case 'PEER_CONNECT_TO_REMOTE_PEER':
                await connectToPeer(signal.payload)
                break
        }
    })

    return {
        getNewUsersInRoom,
        getRoomUsersDiff,
        hasOpenConnection,
        connectToPeer,
        closePeerConnection,
    }
}