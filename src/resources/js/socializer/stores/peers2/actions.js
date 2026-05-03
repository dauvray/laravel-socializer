import { Peer } from "peerjs"

// const buildPeerOptions = (options = {}, metadataOverrides = {}) => {
//     return {
//         ...options,
//         metadata: normalizePeerMetadata({
//             ...(options?.metadata || {}),
//             ...metadataOverrides,
//         }),
//     }
// }

export default {
   setLocalDataPeer(type) {

        if (!this.localPeer) {
            this.createLocalPeer()
        }

        // if the connection listener is already set, we don't need to set it again
        if (this.localPeerReady) return

        this.localPeer.on('connection', async(conn) => {

            conn.on('error', (err) => {
                console.error('Erreur sur la connexion entrante :', err);
            });

            conn.on('close', () => {
                console.log('Connexion call fermée dans actions :', conn.connectionId);

// TODO : on en est ici

                //  this.remoteOpenedConnections.delete(conn.connectionId)
            });

            const meta = conn.options?.metadata || {}

            const callbackKey = meta.callbackKey

            const dynamicCallback = this.incomingConnectionCallbacks.get(callbackKey)

            if (callbackKey && dynamicCallback && !this.remoteOpenedConnections.has(conn.connectionId)) {
                this.remoteOpenedConnections.add(conn.connectionId)
                dynamicCallback(conn)
            } 
            // En prevision car actuellement les dataChannels sont gérés par la callbackKey
            else if (meta.callback) {
                try {
                    const module = await import(`~socializer/callbacks/${meta.callback}.js`)
                    if (typeof module.default === 'function' && !this.remoteOpenedConnections.has(conn.connectionId)) {
                        this.remoteOpenedConnections.add(conn.connectionId)
                        console.log('Appel du callback dynamique', meta.callback)
                        await module.default(conn, context)
                    }
                } catch (e) {
                    console.error(`Callback dynamique ${meta.callback} invalide`, e)
                }
            } else {
                console.warn('Aucun callback trouvé pour cette connexion', meta)
            }
        })

        this.localPeerReady = true
    },
    createLocalPeer() {
        this.localPeer =  new Peer({
            host: import.meta.env.VITE_PEERS_SERVER_HOST,
            port: import.meta.env.VITE_PEERS_SERVER_PORT,
            path: import.meta.env.VITE_PEERS_SERVER_PATH,
            key: import.meta.env.VITE_PEERS_SERVER_KEY,
            secure: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    {
                        urls: `turn:${import.meta.env.VITE_PEERS_SERVER_HOST}:3478`,
                        username: import.meta.env.VITE_COTURN_USERNAME,
                        credential: import.meta.env.VITE_COTURN_CREDENTIAL
                    }
                ]
            }
        })

        this.localPeer.on('open', id => {
            // Workaround for peer.reconnect deleting previous id
            if (id === null) {
                this.localPeer.id = this.lastLocalPeerId
            } else {
                this.lastLocalPeerId = id
            }
        })

        // this.localPeer.on('error', (err) => {
        //     console.error('Erreur PeerJS :', err);
        // })

        this.localPeer.on('disconnected', () => {
            // Workaround for peer.reconnect deleting previous id
            this.localPeer.id = this.lastLocalPeerId
            this.localPeer._lastServerId = this.lastLocalPeerId
            this.localPeer.reconnect()
        })
    },
    registerIncomingPeerCallbacks(callbackKey, callbackFn) {
        this.incomingConnectionCallbacks.set(callbackKey, callbackFn)
    },
    unregisterIncomingPeerCallbacks(callbackKey) {
        this.incomingConnectionCallbacks.delete(callbackKey)
    },
    hasRemotePeerId(userSlug) {
        return this.remotePeersId.has(userSlug)
    },
    addWaitingRemotePeerId(userSlug, { room, type }) {
        this.waitingRemotePeerId.set(userSlug, { room, type })
    },
    hasWaitingRemotePeerId(userSlug) {
        return this.waitingRemotePeerId.has(userSlug)
    },

}