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
import { MAX_RECONNECT_ATTEMPTS, HUB_RATE_WINDOW_MS, HUB_MAX_MESSAGES_PER_WINDOW, PEER_DESTROY_DELAY_MS } from '../webrtc2.config.js'

// -----------------------------------------------------------------------------
// Registre global des contextes WebRTC actifs
// key = contextId (ex: data-room-test, stream-room-test)
// value = ctx complet (avec setUpConnectionListeners)
// -----------------------------------------------------------------------------
const contextRegistry = new Map()

// Promesse d'initialisation du Peer singleton.
// Stockée au niveau module (partagé car peerStore est un singleton Pinia) pour
// éviter la race condition : 2 composants qui appellent setLocalPeer() en même
// temps créeraient chacun une instance Peer distincte.
let _peerInitPromise = null

// Guard auto-reconnect infinie : compteur de tentatives de reconnexion au
// serveur PeerJS. Réinitialisé à chaque connexion réussie (événement 'open').
// Backoff exponentiel : 1s, 2s, 4s, 8s, 16s, 30s (max), puis abandon.
let _reconnectAttempts = 0

// Référence du timer de reconnexion en cours (backoff exponentiel sur 'disconnected').
// Stockée pour pouvoir l'annuler dans _destroyPeerSingleton si la destruction
// survient pendant le délai d'attente.
let _reconnectTimer = null

// ─── Référence counting du Peer singleton ────────────────────────────────────
// Chaque contexte qui appelle setLocalPeer() incrémente ce compteur.
// Chaque onUnmounted() le décrémente. Quand il atteint 0, la destruction est
// planifiée avec un délai (PEER_DESTROY_DELAY_MS). Si un nouveau composant
// remonte entre-temps, la destruction est annulée et le peer est réutilisé.
let _peerConsumerCount = 0
let _peerDestroyTimer = null

function _schedulePeerDestroy(peerStore) {
    // Annule tout timer en cours (ne pas empiler des destructions)
    if (_peerDestroyTimer) {
        clearTimeout(_peerDestroyTimer)
        _peerDestroyTimer = null
    }

    if (PEER_DESTROY_DELAY_MS <= 0) {
        _destroyPeerSingleton(peerStore)
        return
    }

    console.info(
        `[WebRTC2] Dernier consommateur parti — destruction du Peer dans ${PEER_DESTROY_DELAY_MS}ms` +
        ` (annulable si un composant remonte avant)`
    )
    _peerDestroyTimer = setTimeout(() => {
        _peerDestroyTimer = null
        _destroyPeerSingleton(peerStore)
    }, PEER_DESTROY_DELAY_MS)
}

function _destroyPeerSingleton(peerStore) {
    // Cas résiduel : _destroyPeerSingleton peut être appelé après un échec
    // d'initialisation (catch de _peerInitPromise) où localPeer a déjà été remis
    // à null. Dans ce cas, _peerConsumerCount reflète encore les consommateurs
    // actifs (leurs onUnmounted décrémentent normalement jusqu'à 0) — ne pas le
    // réinitialiser ici, cela fausserait le comptage pour un éventuel retry.
    if (!peerStore.localPeer) {
        // Rien à détruire ; annuler le timer de reconnexion par précaution.
        if (_reconnectTimer) {
            clearTimeout(_reconnectTimer)
            _reconnectTimer = null
        }
        _peerInitPromise = null
        console.info('[WebRTC2] _destroyPeerSingleton: peer déjà absent (échec init ou double-appel), skip')
        return
    }

    try {
        if (!peerStore.localPeer.destroyed) {
            peerStore.localPeer.destroy()
        }
    } catch (e) {
        console.warn('[WebRTC2] Erreur lors de la destruction du Peer singleton :', e)
    }
    if (_reconnectTimer) {
        clearTimeout(_reconnectTimer)
        _reconnectTimer = null
    }
    peerStore.localPeer = null
    peerStore.localPeerReady = false
    peerStore.lastLocalPeerId = null
    _reconnectAttempts = 0
    _peerInitPromise = null
    _peerConsumerCount = 0
    console.info('[WebRTC2] Peer singleton détruit')
}

// ─── Rate limiting hub (topologie star) ─────────────────────────────────────
// Fenêtre glissante par expéditeur : chaque entrée est un tableau de timestamps.
// Clé = senderSlug (envelope.from). Partagé entre contextes car le hub est unique.
const _hubRateWindows = new Map()

function _isHubRateLimited(senderSlug) {
    const now = Date.now()
    const windowStart = now - HUB_RATE_WINDOW_MS

    let timestamps = _hubRateWindows.get(senderSlug) ?? []
    // Purge les timestamps hors de la fenêtre glissante
    timestamps = timestamps.filter(ts => ts > windowStart)

    if (timestamps.length >= HUB_MAX_MESSAGES_PER_WINDOW) {
        _hubRateWindows.set(senderSlug, timestamps)
        return true
    }

    timestamps.push(now)
    _hubRateWindows.set(senderSlug, timestamps)
    return false
}

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

    // Indique si ce contexte a bien appelé setLocalPeer() et est donc comptabilisé
    // comme consommateur du Peer singleton. Évite un double-décrémentage si
    // onUnmounted() est appelé sans que setLocalPeer() ait jamais été invoqué.
    let _isRegisteredAsConsumer = false

    // Filet de sécurité : dépollue le registre même si l'orchestrateur ne passe pas
    // par cleanupPeerConnection() (navigation abrupte, crash de composant, etc.).
    onUnmounted(() => {
        unregisterContext(ctx)
        if (_isRegisteredAsConsumer) {
            _peerConsumerCount--
            if (_peerConsumerCount <= 0) {
                _schedulePeerDestroy(ctx.peerStore)
            }
        }
    })

    const setLocalPeer = async () => {

        // Chaque contexte s'enregistre, même si le peer singleton existe déjà.
        registerContext(ctx)

        // Comptabiliser ce contexte comme consommateur du singleton (une seule fois).
        // Le peer ne sera physiquement détruit que quand TOUS les consommateurs
        // auront appelé onUnmounted(), évitant ainsi les crashes croisés.
        // Si un timer de destruction différée est en cours (PEER_DESTROY_DELAY_MS),
        // l'annuler : le peer existant est réutilisé sans recréation.
        if (!_isRegisteredAsConsumer) {
            _isRegisteredAsConsumer = true
            _peerConsumerCount++
            if (_peerDestroyTimer) {
                clearTimeout(_peerDestroyTimer)
                _peerDestroyTimer = null
                console.info('[WebRTC2] Destruction du Peer annulée — nouveau consommateur enregistré')
            }
        }

        const peerStore = ctx.peerStore

        // Le peer local est déjà prêt: rien à recréer, mais le contexte est bien enregistré.
        if(peerStore.localPeerReady) return

        // Guard contre la race condition : 2 composants peuvent passer simultanément
        // (ex: DataRoom + StreamRoom au montage). Le premier crée la promesse d'init,
        // le second attend la même plutôt que de créer un second Peer.
        if (_peerInitPromise) return _peerInitPromise

        const _doInit = async () => {
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
                // Peer utilisable : connexion (re)établie avec le serveur PeerJS.
                // localPeerReady passe à true ici (et non plus au début de _doInit)
                // pour refléter l'état réel : le peer n'est utilisable qu'une fois
                // l'événement 'open' reçu. Idempotent sur les reconnexions.
                peerStore.localPeerReady = true
                // Connexion (re)établie : réinitialise le compteur de reconnexion
                _reconnectAttempts = 0
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

                    // 3. Notifier l'orchestrateur via signal réactif pour relancer le cycle complet.
                    // usePeerOrchestrator observe ce signal via watch() → pas de couplage par mutation.
                    if (registeredCtx.peerUnavailableSignal) {
                        registeredCtx.peerUnavailableSignal.value = targetSlug
                    }
                })
            })

            peerStore.localPeer.on('disconnected', () => {
                // Guard : ne pas tenter de reconnecter un peer nul ou détruit
                if (!peerStore.localPeer || peerStore.localPeer.destroyed) return

                // Guard auto-reconnect infinie : abandon après MAX_RECONNECT_ATTEMPTS
                if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.error(
                        `[WebRTC2] PeerJS: serveur injoignable après ${MAX_RECONNECT_ATTEMPTS} tentatives — abandon.`
                    )
                    return
                }

                _reconnectAttempts++

                // Backoff exponentiel : 1s · 2s · 4s · 8s · 16s … plafonné à 30s
                const delayMs = Math.min(1000 * Math.pow(2, _reconnectAttempts - 1), 30_000)

                console.warn(
                    `[WebRTC2] PeerJS déconnecté — tentative ${_reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} dans ${delayMs}ms`
                )

                _reconnectTimer = setTimeout(() => {
                    if (!peerStore.localPeer || peerStore.localPeer.destroyed) return
                    // Workaround for peer.reconnect deleting previous id
                    peerStore.localPeer.id = peerStore.lastLocalPeerId
                    peerStore.localPeer._lastServerId = peerStore.lastLocalPeerId
                    peerStore.localPeer.reconnect()
                }, delayMs)
            })

            // ---------------------------------------------------------------------
            // Dispatcher global entrant: DataConnection
            // ---------------------------------------------------------------------
            peerStore.localPeer.on('connection', async (conn) => { 
                const metadata = conn?.metadata || conn?.options?.metadata || {}
                const targetCtx = resolveContextByMetadata(metadata)

                if (!targetCtx) {
                    console.warn(
                        "[WebRTC2] Aucun contexte trouvé pour connection entrante — connexion fermée",
                        metadata
                    )
                    try { conn.close() } catch (e) { /* ignore */ }
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
                        "[WebRTC2] Aucun contexte trouvé pour call entrant — appel fermé",
                        metadata
                    )
                    try { call.close() } catch (e) { /* ignore */ }
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

        } // end _doInit

        _peerInitPromise = _doInit()
            .catch(err => {
                // En cas d'échec : localPeerReady est encore false (on('open') n'a
                // pas été reçu), localPeer est remis à null pour permettre un retry.
                // _peerConsumerCount N'est PAS remis à 0 ici : les consommateurs
                // actifs (composants montés) doivent continuer à décrémenter
                // normalement via onUnmounted — les remettre à 0 ici créerait un
                // décalage si un nouveau composant s'enregistre avant que les anciens
                // unmontent, pouvant déclencher la destruction d'un peer valide.
                // _destroyPeerSingleton gère explicitement le cas localPeer=null.
                console.error('[WebRTC2] Échec d\'initialisation du Peer :', err)
                peerStore.localPeerReady = false
                peerStore.localPeer = null
            })
            .finally(() => { _peerInitPromise = null })
        return _peerInitPromise
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
        // ── Rate limiting ────────────────────────────────────────────────────────
        // Protection contre les rafales de messages : si un client dépasse
        // HUB_MAX_MESSAGES_PER_WINDOW messages dans HUB_RATE_WINDOW_MS, l'excédent
        // est abandonné pour éviter la saturation du hub.
        if (_isHubRateLimited(envelope.from)) {
            console.warn(
                `[Hub] Rate limit dépassé (${HUB_MAX_MESSAGES_PER_WINDOW} msg/${HUB_RATE_WINDOW_MS}ms)` +
                ` — message de '${envelope.from}' abandonné`
            )
            return
        }

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