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

    const hasOpenConnection = (userSlug) => {
        const room = ctx.currentRoom.value
        const type = ctx.currentType.value
        const roomConnections = ctx.peerStore.getConnections?.[room]?.[userSlug]?.[type] ?? []
        return Array.isArray(roomConnections) && roomConnections.some(conn => conn?.open)
    }

    const connectToPeer = (payload) => {

        const userSlug = payload?.userSlug
        const peerId = payload?.peerId ? String(payload.peerId) : null

        if (!userSlug || !peerId) {
            console.warn('Connexion peer ignorée: userSlug ou peerId manquant', payload)
            return false
        }

        // Si la connexion avec ce type existe déjà et est ouverte, on ne recrée rien.
        if (hasOpenConnection(userSlug)) {
            return true
        }

        // On supprime le waiting flag seulement quand on a une vraie cible exploitable.
        if (ctx.peerStore.hasWaitingRemotePeerId(userSlug)) {
            ctx.peerStore.removeWaitingRemotePeerId(userSlug)
        }

        if(!ctx.peerStore.hasRemotePeerId(userSlug)) {
            ctx.peerStore.addRemotePeerId(userSlug, peerId)
        }

        const config = _buildPeerConnectionConfig(payload)
       
        if (config.options.metadata.type === 'data') {
            try {
                const conn = ctx.peerStore.getLocalPeer.connect(config.peerId, config.options)
                _saveRoomConnection(config, conn)
                return true
            } catch (error) {
                console.error('Erreur pendant connectToPeer', error)
                return false
            }
        } 
        
        else if (config.options.metadata.type === 'stream' && ctx.media.currentStream) {
            try {
                const call = ctx.peerStore.getLocalPeer.call(config.peerId, config.stream, config.options)
                _saveRoomConnection(config, call)
                return true
            } catch (error) {
                console.error('Erreur pendant connectToPeer (stream)', error)
                return false
            }
        }

        return true
    }

    const stopBroadcastCalls = () => {
        const room = ctx.currentRoom.value
        const type = ctx.currentType.value
        const roomConnections = ctx.peerStore.getConnections?.[room] ?? {}

        Object.keys(roomConnections).forEach((userSlug) => {
            ctx.peerStore.closePeerConnection(room, userSlug, type)
            ctx.peerStore.clearConnectionsRoom(room, userSlug, type)
        })
    }

    const closePeerConnection = () => {
        const currentType = ctx.session.currentType
        const currentRoom = ctx.session.currentRoom
        const roomConnections = ctx.peerStore.getConnections?.[currentRoom]

         if(roomConnections && typeof roomConnections === 'object') {
            for (const userSlug in roomConnections) {
                ctx.peerStore.closePeerConnection(
                    currentRoom,
                    userSlug,
                    currentType
                )
                ctx.peerStore.clearConnectionsRoom(currentRoom, userSlug, currentType)
                ctx.peerStore.clearSignalQueueRoom(ctx.contextId)
                ctx.peerStore.removeRemotePeerId(userSlug)

                // On nettoie aussi les traces waiting pour éviter les faux positifs au prochain sync.
                if (ctx.peerStore.hasWaitingRemotePeerId(userSlug)) {
                    ctx.peerStore.removeWaitingRemotePeerId(userSlug)
                }
            }
        }
    }

    const _buildPeerConnectionConfig = (payload) => {
        const config = {
            peerId: String(payload.peerId),
            options: {
                metadata: {
                    slug: String(payload.userSlug),
                    from: String(ctx.meStore.getMe.slug),
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
        } else if (payload.type === 'stream') {
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
        stopBroadcastCalls,
    }
}