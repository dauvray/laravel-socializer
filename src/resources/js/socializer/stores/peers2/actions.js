import { isEmpty } from '~estarter/services/helpers.js'

export default {

    setLocalPeer(peer = null) {
        this.localPeer = peer
    },
    setLocalPeerReady(ready = false) {
        this.localPeerReady = ready
    },
    setLastLocalPeerId(peerId = null) {
        this.lastLocalPeerId = peerId
    },

    prepareRoomConnection(payload) {

        const userSlug = payload.options.metadata.slug
        const room = payload.options.metadata.room
        const type = payload.options.metadata.type

        const connections = { ...this.connections }

        if (!connections[room]) {
            connections[room] = {}
        }

        if (!connections[room][userSlug]) {
            connections[room][userSlug] = {}
        }

        if (!connections[room][userSlug][type]) {
            connections[room][userSlug][type] = []
        } else {
            return
        }

        this.connections = connections
    },
    storePeerConnection(room, slug, type, connection) {
        this.connections[room][slug][type].push(connection)
    },
    removePeerConnectionInstance(room, slug, type, connection) {
        if (!room || !slug || !type) {
            return
        }

        if (
            !this.connections.hasOwnProperty(room)
            || !this.connections[room].hasOwnProperty(slug)
            || !this.connections[room][slug].hasOwnProperty(type)
        ) {
            return
        }

        const currentConnections = this.connections[room][slug][type]

        this.connections[room][slug][type] = currentConnections.filter((item) => {
            if (!item) {
                return false
            }

            if (item === connection) {
                return false
            }

            const sameConnectionId =
                connection?.connectionId
                && item?.connectionId
                && item.connectionId === connection.connectionId

            return !sameConnectionId
        })

        // Important: NE PAS relancer closePeerConnection ici.
        // Sinon on peut boucler: close event -> remove -> closePeerConnection -> close event...
        if (this.connections[room][slug][type].length === 0) {
            this.clearConnectionsRoom(room, slug, type)
        }
    },
    closePeerConnection(room, slug, type) {
        if (
            !this.connections.hasOwnProperty(room)
            || !this.connections[room].hasOwnProperty(slug)
            || !this.connections[room][slug].hasOwnProperty(type)
        ) {
            return
        }

        this.connections[room][slug][type].forEach((conn) => {
            if (!conn || typeof conn !== 'object') {
                return
            }

            // Idempotence: ne pas fermer plusieurs fois la même instance
            if (conn.__ctxClosing === true || conn.__ctxCloseHandled === true) {
                return
            }

            if (!conn.hasOwnProperty('peer')) {
                return
            }

            switch (type) {
                case 'data': {
                    // DataConnection: close uniquement si ouvert
                    if (typeof conn.close === 'function' && conn.open === true) {
                        conn.__ctxClosing = true
                        try {
                            conn.close()
                        } catch (e) {
                            console.warn('Erreur fermeture DataConnection', e)
                        }
                    }
                    break
                }

                case 'stream':
                case 'screen':
                case 'visio':
                case 'vocal': {
                    conn.__ctxClosing = true

                    // MediaConnection PeerJS
                    if (typeof conn.close === 'function') {
                        try {
                            conn.close()
                        } catch (e) {
                            console.warn('Erreur fermeture MediaConnection', e)
                        }
                    }

                    // Fallback RTCPeerConnection
                    const pc = conn.peerConnection
                    if (
                        pc
                        && typeof pc.close === 'function'
                        && pc.signalingState !== 'closed'
                    ) {
                        try {
                            pc.close()
                        } catch (e) {
                            console.warn('Erreur fermeture RTCPeerConnection', e)
                        }
                    }

                    break
                }

                default:
                    break
            }
        })
    },
    clearConnectionsRoom(room, slug, type) {

        if(!this.connections.hasOwnProperty(room)) {
            return
        }

        if(!this.connections[room].hasOwnProperty(slug)) {
            return
        }

        if(this.connections[room][slug].hasOwnProperty(type)) {
            delete this.connections[room][slug][type]
        }

        if(isEmpty(this.connections[room][slug])) {
            delete this.connections[room][slug]
        }

        if(isEmpty(this.connections[room])) {
            delete this.connections[room]
        }
    },
    // Gérer les signaux provenant des autres composants (Notifications.vue)
    dispatchSignal(signal) {

        const key = signal.roomId

        // `seq` monotone PAR CLÉ DE FILE : useSignalingQueue ne consomme que le dernier
        // signal de la room (at(-1)), donc deux dispatch dans le même tick n'en
        // déclencheraient qu'un — le trou dans la suite des seq est la seule preuve
        // possible de cette perte (cf. TODOLIST « Détecter un signal coalescé »).
        // ⚠️ Un compteur global créerait un trou à chaque signal d'une AUTRE room, donc
        // un faux positif ; et il n'est volontairement pas supprimé par
        // clearSignalQueueRoom, pour rester monotone à travers les vidages de file
        // (sinon le consommateur devrait détecter un rewind).
        this.signalSeq[key] = (this.signalSeq[key] ?? 0) + 1

        const s = { ...signal, ts: Date.now(), seq: this.signalSeq[key] }
        this.lastSignal = s

        if (!this.signalQueues[key]) {
            this.signalQueues[key] = []
        }
        this.signalQueues[key].push(s)

         // Garde un historique limité par room
        if (this.signalQueues[key].length > 10) {
            this.signalQueues[key].shift()
        }
    },
    clearSignalQueueRoom(roomId) {
        // ⚠️ signalSeq[roomId] n'est PAS supprimé : le compteur doit rester monotone
        // à travers les vidages, sinon le seq repartirait à 1 et le détecteur de
        // coalescence de useSignalingQueue verrait un rewind.
        delete this.signalQueues[roomId]
    },
    createSignalQueueRoom(roomId) {
        if (!this.signalQueues[roomId]) {
            this.signalQueues[roomId] = []
        }
    },

    // Supprimer l’id d’un peer distant lorsqu’il n'est plus dans auncune room
    removeRemotePeerId(userSlug) {
        const isUserConnected = Object.values(this.connections).some(room => userSlug in room)
        if (!isUserConnected) {
            this.remotePeersId.delete(userSlug)
        }
    },
    // Enregistrer l’id d’un peer distant lorsqu’il est reçu
    addRemotePeerId(userSlug, peerId) {
        this.remotePeersId.set(userSlug, peerId)
    },

    // Gérer les connexions en attente d’un peer id distant
    addWaitingRemotePeerId(userSlug, data) {
        this.waitingRemotePeerId.set(userSlug, {
           ...data,
            createdAt: Date.now(),
        })
    },
    removeWaitingRemotePeerId(userSlug) {
        this.waitingRemotePeerId.delete(userSlug)
    },

    // gestion des players actifs (pour les appels en cours)
    addPlayer(player) {
        this.players.push(player)
    },
    removePlayer(player) {
        this.players = this.players.filter(p => p.videoId !== player)
    },

}