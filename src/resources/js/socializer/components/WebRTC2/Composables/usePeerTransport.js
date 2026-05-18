/**
 * 📡 usePeerTransport (DataChannel Layer)
 * 
 * abstraction du transport DATA (PeerJS data connections)
 * 
 * 👉 gère :
 * - communication via datachannel (send / receive)
 * - enregistrement des callbacks entrants
 *
 * 👉 ne gère PAS :
 * - audio / vidéo
 * - UI
 * - signaling
 *
 * 👉 rôle :
 * - abstraction du transport de données temps réel
 * - indépendant du media (réutilisable pour chat, events, etc.)
 * 
 */

import { Peer } from "peerjs"
import { markRaw, onUnmounted, watch } from 'vue'

// -----------------------------------------------------------------------------
// Registre global des contextes WebRTC actifs
// key = contextId (ex: data-room-test, stream-room-test)
// value = ctx complet (avec setUpConnectionListeners)
// -----------------------------------------------------------------------------
const contextRegistry = new Map()

function registerContext(ctx) {
    if (!ctx?.contextId) return
    contextRegistry.set(ctx.contextId, ctx)
}

function unregisterContext(ctx) {
    if (!ctx?.contextId) return
    contextRegistry.delete(ctx.contextId)
}

function resolveContextByMetadata(metadata) {
    const callbackKey = metadata?.callbackKey
    if (callbackKey && contextRegistry.has(callbackKey)) {
        return contextRegistry.get(callbackKey)
    }
    return null
}

export function usePeerTransport(ctx) {

    // Filet de sécurité : dépollue le registre même si l'orchestrateur ne passe pas
    // par cleanupPeerConnection() (navigation abrupte, crash de composant, etc.).
    onUnmounted(() => {
        unregisterContext(ctx)
    })

    const setLocalPeer = async () => {

        // Chaque contexte s'enregistre, même si le peer singleton existe déjà.
        registerContext(ctx)

        const peerStore = ctx.peerStore

        // Le peer local est déjà prêt: rien à recréer, mais le contexte est bien enregistré.
        if(peerStore.localPeerReady) return

        peerStore.localPeerReady = true

        peerStore.localPeer = markRaw(new Peer({
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
        }))

        // a la création du Peer
        peerStore.localPeer.on('open', id => {
            // Workaround for peer.reconnect deleting previous id
            if (id === null) {
                peerStore.localPeer.id = peerStore.lastLocalPeerId
            } else {
                peerStore.lastLocalPeerId = id
            }
        })

        peerStore.localPeer.on('error', (err) => {
            console.error('Erreur PeerJS :', err);

            // ── Recovery peer-unavailable ─────────────────────────────────────
            // PeerJS émet 'peer-unavailable' quand le peerId distant n'est pas (ou
            // plus) enregistré sur le serveur de signalisation.
            // Sans traitement, la connexion échouée reste dans le store avec
            // hasOpenConnection() qui retourne true (fallback peerConnection=null),
            // ce qui bloque le retry → le remote player n'apparaît jamais.
            //
            // Fix : on supprime la connexion échouée + on invalide le peerId stale
            //       + on notifie l'orchestrateur pour relancer le cycle complet.
            // ─────────────────────────────────────────────────────────────────
            if (err.type !== 'peer-unavailable') return

            // Format du message PeerJS : "Could not connect to peer <peerId>"
            const msgWords = typeof err.message === 'string' ? err.message.split(' ') : []
            const failedPeerId = msgWords.length > 0 ? msgWords[msgWords.length - 1] : null
            if (!failedPeerId) return

            contextRegistry.forEach((registeredCtx) => {
                // Recherche inverse peerId → userSlug dans ce contexte
                let targetSlug = null
                for (const [slug, peerId] of (registeredCtx.peerStore.remotePeersId?.entries?.() ?? [])) {
                    if (String(peerId) === String(failedPeerId)) {
                        targetSlug = slug
                        break
                    }
                }
                if (!targetSlug) return

                const room = registeredCtx.session.currentCallRoomId || registeredCtx.session.currentRoom
                const type = registeredCtx.session.currentType

                // Ne traiter que les contextes qui ont réellement une connexion vers ce peerId
                const conns = [...(registeredCtx.peerStore.getConnections?.[room]?.[targetSlug]?.[type] ?? [])]
                const failedConns = conns.filter(conn => conn?.peer === String(failedPeerId))
                if (failedConns.length === 0) return

                // 1. Retirer la connexion échouée du store (libère le guard hasOpenConnection)
                failedConns.forEach(conn => {
                    registeredCtx.peerStore.removePeerConnectionInstance(room, targetSlug, type, conn)
                })

                // 2. Invalider le peerId stale pour forcer une nouvelle demande de signalisation
                registeredCtx.peerStore.removeRemotePeerId(targetSlug)

                // 3. Notifier l'orchestrateur pour relancer le cycle complet de connexion
                registeredCtx.hooks?.onPeerUnavailable?.(targetSlug)
            })
        })

        peerStore.localPeer.on('disconnected', () => {
            // Workaround for peer.reconnect deleting previous id
            peerStore.localPeer.id = peerStore.lastLocalPeerId
            peerStore.localPeer._lastServerId = peerStore.lastLocalPeerId
            peerStore.localPeer.reconnect()
        })

        // ---------------------------------------------------------------------
        // Dispatcher global entrant: DataConnection
        // ---------------------------------------------------------------------
        peerStore.localPeer.on('connection', async (conn) => { 
            const metadata = conn?.metadata || conn?.options?.metadata || {}
            const targetCtx = resolveContextByMetadata(metadata)

            if (!targetCtx) {
                console.warn(
                    "[WebRTC2] Aucun contexte trouvé pour connection entrante",
                    metadata
                )
                return
            }

            targetCtx.setUpConnectionListeners(conn)
        })

        // ---------------------------------------------------------------------
        // Dispatcher global entrant: MediaConnection (call stream/screen)
        // ---------------------------------------------------------------------
        peerStore.localPeer.on('call', async (call) => {
            const metadata = call?.metadata || {}
            const callType = metadata?.type

            if (callType !== 'stream' && callType !== 'screen' && callType !== 'visio' && callType !== 'vocal') {
                return
            }

            const targetCtx = resolveContextByMetadata(metadata)

            if (!targetCtx) {
                console.warn(
                    "[WebRTC2] Aucun contexte trouvé pour call entrant",
                    metadata
                )
                return
            }

            const getLocalStream = () => targetCtx.media?.currentStream || null
            const isOneWay = callType === 'stream' || callType === 'screen'

            if (isOneWay) {
                call.answer(getLocalStream() || undefined)
                targetCtx.setUpConnectionListeners(call)
                return
            }

            // Attend le stream local via watch réactif (évite le polling)
            const waitForLocalStream = (timeoutMs = 5000) => {
                return new Promise((resolve) => {
                    const current = getLocalStream()
                    if (current) { resolve(current); return }

                    let timeoutId
                    const stop = watch(
                        () => targetCtx.media?.currentStream,
                        (val) => {
                            if (val) {
                                clearTimeout(timeoutId)
                                stop()
                                resolve(val)
                            }
                        },
                        { immediate: false }
                    )
                    timeoutId = setTimeout(() => { stop(); resolve(null) }, timeoutMs)
                })
            }

            let localStream = await waitForLocalStream()

            if (!localStream) {
                console.warn('Call entrant ignoré: aucun stream local disponible pour répondre', call)
                return
            }

            call.answer(localStream)
            targetCtx.setUpConnectionListeners(call)
        })

        return await ctx.waitForMeReady()
    }

    const unregisterLocalContext = () => {
        unregisterContext(ctx)
    }

    const _getOpenDataConnection = (room, userSlug) => {
        const roomConnections = ctx.peerStore.getConnections?.[room]?.[userSlug]?.data ?? []
        
        if (!Array.isArray(roomConnections) || roomConnections.length === 0) {
            return null
        }

        return roomConnections.find(conn => conn?.open) ?? null
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 🔁 forwardStarMessage — utilisée UNIQUEMENT par le hub en topologie star
    //
    // Quand le hub reçoit un message d'un client avec __starRoute: true,
    // il appelle cette fonction pour le retransmettre aux bons destinataires.
    //
    // Paramètres de l'enveloppe :
    //   envelope.from    → slug de l'expéditeur (exclu de la retransmission)
    //   envelope.to      → liste de slugs ciblés, ou null pour "tout le monde"
    //   envelope.payload → les vraies données à livrer
    // ─────────────────────────────────────────────────────────────────────────────
    const forwardStarMessage = (envelope) => {
        const room = ctx.session.onAirRoom

        // Si `to` est fourni, on cible ces slugs. Sinon, on prend tous les users de la room.
        // Dans les deux cas, on exclut l'expéditeur (inutile de lui renvoyer son propre message).
        const targets = (envelope.to || ctx.connection.usersInRoom)
            .filter(slug => slug !== envelope.from)

        targets.forEach(userSlug => {
            const conn = _getOpenDataConnection(room, userSlug)
            if (!conn) {
                console.warn('[Hub] Retransmission ignorée: connexion indisponible pour', userSlug)
                return
            }
            // On envoie uniquement le payload (sans l'enveloppe de routage)
            conn.send(envelope.payload)
        })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 📤 sendData — envoie des données à un ou plusieurs peers
    //
    // Comportement selon la topologie :
    //
    //   MESH : envoi direct à chaque peer connecté (via leur connexion datachannel respective)
    //
    //   STAR hub    : envoi direct aux destinataires (le hub a une connexion avec tout le monde)
    //   STAR client : envoi au hub dans une "enveloppe" → le hub se chargera de retransmettre
    //
    //   SFU : non géré ici (le serveur SFU fait le routage lui-même)
    // ─────────────────────────────────────────────────────────────────────────────
    const sendData = (data, destUserSlugs = null) => {

        const room = ctx.session.onAirRoom

        // ── TOPOLOGIE MESH ──────────────────────────────────────────────────────
        // Chaque peer est connecté à tous les autres → on envoie directement à chacun.
        if (ctx.topology.value === 'mesh') {
            const targets = destUserSlugs || ctx.connection.usersInRoom
            targets.forEach(userSlug => {
                const conn = _getOpenDataConnection(room, userSlug)
                if (!conn) {
                    console.warn('[Mesh] Envoi ignoré: connexion indisponible pour', userSlug)
                    return
                }
                conn.send(data)
            })
            return
        }

        // ── TOPOLOGIE STAR ──────────────────────────────────────────────────────
        if (ctx.topology.value === 'star' && ctx.hubSlug.value) {

            // CAS 1 — Je suis le hub
            // Le hub est connecté à tout le monde → envoi direct aux destinataires.
            if (ctx.isHub.value) {
                const targets = destUserSlugs || ctx.connection.usersInRoom
                targets.forEach(userSlug => {
                    const conn = _getOpenDataConnection(room, userSlug)
                    if (!conn) {
                        console.warn('[Hub] Envoi ignoré: connexion indisponible pour', userSlug)
                        return
                    }
                    conn.send(data)
                })
                return
            }

            // CAS 2 — Je suis un client
            // Je suis uniquement connecté au hub.
            // Je lui envoie une "enveloppe" contenant les destinataires voulus + mes données.
            // Le hub interceptera cette enveloppe et retransmettra lui-même.
            const envelope = {
                __starRoute: true,          // 🚩 marqueur : "hub, retransmet ce message"
                to: destUserSlugs || null,  // destinataires cibles (null = tout le monde sauf moi)
                from: ctx.mySlug.value,     // mon slug → le hub m'exclura de la retransmission
                payload: data,              // les vraies données à livrer
            }

            const conn = _getOpenDataConnection(room, ctx.hubSlug.value)
            if (!conn) {
                console.warn('[Client] Envoi ignoré: connexion hub indisponible', ctx.hubSlug.value)
                return
            }
            conn.send(envelope)
        }
    }

    return {
        setLocalPeer,
        unregisterLocalContext,
        sendData,
        forwardStarMessage,
    }
}