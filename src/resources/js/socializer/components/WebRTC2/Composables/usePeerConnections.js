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
 * Fonctions concernées :
 * ----------------------
 * connectToQueuedConnections
 * storeConnection
 * closeRemotePeerId
 * deleteRemoteOpenedConnections
 *
 * __syncUsersConnections
 * syncJoingingUsers
 *
 * ConnectionsHasTypeInRoom
 *
 * saveRemoteStream
 * removeRemoteStream
 */

import { deepGet } from '~estarter/services/helpers.js'

export function usePeerConnections(ctx) {

    // const connectToPeer = (payload) => {

    //     const stream = ctx.media.currentStream

    //     const connection = ctx.peerStore.openPeerConnection({
    //         peerId: payload.peerId,
    //         room: ctx.session.onAirRoom,
    //         type: ctx.session.currentType,
    //         stream: stream,
    //         options: {
    //             metadata: {
    //                 slug: payload.userSlug,
    //                 from: ctx.meStore.getMe.slug,
    //                 source: ctx.session.currentType,
    //                 room: ctx.session.onAirRoom,
    //             }
    //         }
    //     })

    //     if (connection?.call) {
    //         connection.call.on('stream', (remoteStream) => {
    //             ctx.peerStore.saveRemoteStream(
    //                 ctx.session.onAirRoom,
    //                 payload.userSlug,
    //                 remoteStream,
    //                 ctx.session.currentType
    //             )
    //         })
    //     }
    // }

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
        const newUsers = usersInRoom.filter(user => !ctx.connection.previousUsersInRoom.includes(user.slug))

        // Mettre à jour la liste des utilisateurs présents dans la salle
        ctx.connection.previousUsersInRoom = usersInRoom.map(user => user.slug)

        return newUsers
    }

    return {
      //  connectToPeer,
        getNewUsersInRoom,
    }
}