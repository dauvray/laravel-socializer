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

   // let connectionInitialized = false

    const getNewUsersInRoom = async (users = []) => {

        // attendre que  meStore.getMe.slug disponible avant d’initialiser la connexion
        await ctx.waitForMeReady()

        let usersInRoom = []

        users.forEach( user => {
            // if user is not me
            if(user.slug !== ctx.meStore.getMe.slug) {
                usersInRoom.push(user)
            }
        })

        // Identifier les nouveaux utilisateurs
        const newUsers = usersInRoom.filter(user => !ctx.connection.usersInRoom.includes(user.slug))

        // Mettre à jour la liste des utilisateurs présents dans la salle
        ctx.connection.usersInRoom = usersInRoom.map(user => user.slug)

        return newUsers
    }

    const connectToPeer = (payload) => {

        if(ctx.peerStore.hasWaitingRemotePeerId(payload.userSlug)) {
            ctx.peerStore.removeWaitingRemotePeerId(payload.userSlug)
        }

        ctx.peerStore.addRemotePeerId(payload.userSlug, payload.peerId)

        const config = _buildPeerConnectionConfig(payload)

        ctx.peerStore.initConnection(config)

        if(config.options.metadata.type === 'data') {

            const conn = ctx.peerStore.getLocalPeer.connect(config.peerId, config.options)
            ctx.setUpConnectionListeners(conn)
            _storeRoomConnection(config, conn)


            // if(!connectionInitialized) {
            //      _setDataEventsConnectionListener(payload)
            // }

        } else {
            // pour les connexions de type media, on attend d’avoir le stream avant d’ouvrir la connexion (car besoin du stream dans la connexion)
            // c’est géré dans usePeerMedia.startCallStream → createVideoPeer
        } 


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
                }
            }
        }

        if (payload.type === 'data') {
            // Whether the underlying data channels should be reliable (e.g. for large file transfers) 
            // or not (e.g. for gaming or streaming).
            config.options.reliable = true
            config.options.metadata.callbackKey = ctx.contextId
        } else {
           // todo : a examnier quand on fera du streaming
           // config.stream = ctx.peerStore.getStream(payload.room, payload.type)
        }

        return config
    }

    const _storeRoomConnection = (config, connection) => {
        ctx.peerStore.storePeerConnection(
            config.options.metadata.room,
            config.options.metadata.slug,
            config.options.metadata.type,
            connection
        )
    }

    // const _openPeerMediaConnection = (config) => {
    //     const slug = options.metadata.slug
    //     const room = options.metadata.room
    //     const type = options.metadata.type
    //     const ignoredDataConnections = [] // put here video types without dataPeerConnection
    // }

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
        connectToPeer,
        closePeerConnection,
    }
}