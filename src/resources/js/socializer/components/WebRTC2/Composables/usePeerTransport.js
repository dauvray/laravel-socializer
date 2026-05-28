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
import { 
    MAX_RECONNECT_ATTEMPTS, 
    HUB_RATE_WINDOW_MS, 
    HUB_MAX_MESSAGES_PER_WINDOW, 
    MAX_PAYLOAD_BYTES, 
    PEER_DESTROY_DELAY_MS, 
    RECONNECT_BASE_DELAY_MS, 
    RECONNECT_MAX_DELAY_MS, 
    SLUG_PATTERN,
    STREAM_WAIT_TIMEOUT_MS } from '../webrtc2.config.js'
import { getPayloadSizeBytes, isPayloadWithinLimit } from './utils/payloadSize.js'
import { sanitizeMetadataType } from './utils/sanitizeMetadata.js'

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
// Clé = senderIdentity (peerId entrant réel). Partagé entre contextes car le hub est unique.
const _hubRateWindows = new Map()
// Horodatage du dernier balayage global, pour throttler la purge des entrées
// d'expéditeurs déconnectés à au plus une fois par fenêtre glissante.
let _hubRateLastSweep = 0

// Purge les expéditeurs dont tous les timestamps ont expiré : leurs entrées ne
// seraient jamais nettoyées autrement (la fonction n'est plus appelée pour un
// slug déconnecté), d'où une croissance illimitée de la Map au fil des rotations
// de room. Suppression pendant l'itération d'une Map : sûre par spec.
function _sweepHubRateWindows(windowStart) {
    for (const [identity, timestamps] of _hubRateWindows) {
        if (!timestamps.some(ts => ts > windowStart)) {
            _hubRateWindows.delete(identity)
        }
    }
}

function _isHubRateLimited(senderIdentity) {
    const now = Date.now()
    const windowStart = now - HUB_RATE_WINDOW_MS

    // Balayage global throttlé : évite la fuite mémoire sur slugs déconnectés.
    if (now - _hubRateLastSweep >= HUB_RATE_WINDOW_MS) {
        _hubRateLastSweep = now
        _sweepHubRateWindows(windowStart)
    }

    let timestamps = _hubRateWindows.get(senderIdentity) ?? []
    // Purge les timestamps hors de la fenêtre glissante
    timestamps = timestamps.filter(ts => ts > windowStart)

    if (timestamps.length >= HUB_MAX_MESSAGES_PER_WINDOW) {
        _hubRateWindows.set(senderIdentity, timestamps)
        return true
    }

    timestamps.push(now)
    _hubRateWindows.set(senderIdentity, timestamps)
    return false
}

// Validation de slug côté hub : rejette les destinataires forgés avant retransmission
// star. SLUG_PATTERN est centralisé dans webrtc2.config.js (source de vérité partagée
// avec usePeerOrchestrator).
function _isValidSlug(value) {
    return typeof value === 'string' && SLUG_PATTERN.test(value)
}

function _resolveSenderSlugFromIncomingConn(conn, ctx) {
    const senderPeerId = conn?.peer ? String(conn.peer) : null
    if (!senderPeerId) return null

    const usersInRoom = Array.isArray(ctx?.connection?.usersInRoom)
        ? ctx.connection.usersInRoom
        : []

    // Priorité: ne considérer que les membres connus de la room courante.
    for (const slug of usersInRoom) {
        const mappedPeerId = ctx?.peerStore?.getRemotePeerId?.(slug)
        if (mappedPeerId && String(mappedPeerId) === senderPeerId) {
            return slug
        }
    }

    // Fallback défensif: parcourt la map complète si usersInRoom est temporairement vide.
    for (const [slug, peerId] of (ctx?.peerStore?.remotePeersId?.entries?.() ?? [])) {
        if (peerId && String(peerId) === senderPeerId) {
            return slug
        }
    }

    return null
}

// ─── Authentification des connexions/appels entrants ─────────────────────────
// Faille [HAUTE]: localPeer.on('connection'|'call') acceptait toute connexion dont
// le peerId était connu, sans vérifier que l'émetteur est un membre autorisé de la
// room — un tiers connaissant un peerId pouvait ouvrir un datachannel ou déclencher
// un appel et recevoir le stream local.
//
// Règle d'admission (appliquée AVANT setUpConnectionListeners / call.answer):
//   1. `metadata.from` doit avoir un format de slug valide (_isValidSlug)
//   2. L'émetteur doit être autorisé via L'UN des deux chemins suivants :
//      (a) Chemin présence : `metadata.from` ∈ `ctx.connection.usersInRoom` — cas
//          diffusion/chat dans une room de présence Reverb partagée.
//      (b) Chemin appel direct : `peerStore.getRemotePeerId(metadata.from)` existe
//          ET est égal à l'identité PeerJS réelle de la connexion (`conn.peer`).
//          Le mapping slug→peerId est exclusivement alimenté par la signalisation
//          backend `peer-access-permission` (acceptCallFromPeer côté récepteur,
//          openCallBetweenPeer côté initiateur), donc sa présence ET sa correspondance
//          tiennent lieu d'autorisation ET d'anti-usurpation en une seule condition.
//   3. Pour le chemin présence : défense-en-profondeur — si l'identité PeerJS réelle
//      est déjà résolue à un slug connu (via le mapping global), ce slug doit
//      correspondre à `metadata.from` — sinon tentative d'usurpation intra-room → rejet.
//
// Important : `ctx.session.currentCallUsers` n'est PAS consulté ici. C'est un état UI
// (qui voir/raccrocher) alimenté à partir de la même signalisation, mais réutiliser un
// état applicatif comme allowlist de sécurité couple politique et affichage et laisse
// passer une connexion entrante avant que le mapping peerId ne soit prêt.
function _isAuthorizedIncomingPeer(metadata, conn, ctx) {
    const declaredFrom = metadata?.from

    if (!_isValidSlug(declaredFrom)) {
        console.warn(
            '[WebRTC2] Connexion entrante refusée: `metadata.from` absent ou format de slug invalide',
            { declaredFrom, senderPeerId: conn?.peer }
        )
        return false
    }

    const usersInRoom = Array.isArray(ctx?.connection?.usersInRoom)
        ? ctx.connection.usersInRoom
        : []
    const senderPeerId = conn?.peer ? String(conn.peer) : null

    const isRoomMember = usersInRoom.includes(declaredFrom)

    // Chemin (b) — appel direct vérifié : exige le mapping signalé ET la correspondance
    // avec le peerId PeerJS réel. Les deux vérifications sont fusionnées : si l'une
    // manque, ce chemin échoue et seul (a) peut autoriser.
    const mappedPeerId = ctx?.peerStore?.getRemotePeerId?.(declaredFrom)
    const isVerifiedDirectCallPeer =
        !!mappedPeerId && !!senderPeerId && String(mappedPeerId) === senderPeerId

    if (!isRoomMember && !isVerifiedDirectCallPeer) {
        console.warn(
            "[WebRTC2] Connexion entrante refusée: émetteur ni membre de la room ni interlocuteur autorisé (mapping peerId absent/non concordant)",
            { declaredFrom, senderPeerId, usersInRoom, hasMappedPeerId: !!mappedPeerId }
        )
        return false
    }

    // Anti-usurpation chemin (a) — si membre de room et que le peerId réel est
    // déjà résolu à un autre slug, rejet. Pour le chemin (b), la correspondance
    // mappedPeerId === senderPeerId est déjà vérifiée plus haut.
    if (isRoomMember) {
        const resolvedSlug = _resolveSenderSlugFromIncomingConn(conn, ctx)
        if (resolvedSlug && resolvedSlug !== declaredFrom) {
            console.warn(
                '[WebRTC2] Connexion entrante refusée: usurpation détectée (peerId réel ≠ `from` déclaré)',
                { declaredFrom, resolvedSlug, senderPeerId }
            )
            return false
        }
    }

    return true
}

function registerContext(ctx) {
    if (!ctx?.contextId) return
    contextRegistry.set(ctx.contextId, ctx)
}

function unregisterContext(ctx) {
    if (!ctx?.contextId) return
    // Ne supprimer que si l'entrée du registre appartient TOUJOURS à ce contexte.
    // registerContext applique un last-write-wins volontaire (un contexte remonté
    // reprend l'id d'un contexte en cours de démontage) ; sans ce garde, l'onUnmounted
    // de l'ancien contexte effacerait l'entrée désormais détenue par le nouveau,
    // qui ne recevrait alors plus aucune connexion entrante.
    if (contextRegistry.get(ctx.contextId) === ctx) {
        contextRegistry.delete(ctx.contextId)
    }
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

                // Backoff exponentiel : BASE · BASE*2 · BASE*4 … plafonné à MAX_DELAY
                const delayMs = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, _reconnectAttempts - 1), RECONNECT_MAX_DELAY_MS)

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

                // Authentification: l'émetteur doit être un membre autorisé de la room.
                if (!_isAuthorizedIncomingPeer(metadata, conn, targetCtx)) {
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
                // `metadata.type` est fourni par le pair distant : on le passe par la
                // sanitization centralisée (VALID_CONNECTION_TYPES) avant tout usage,
                // puis on exclut 'data' qui n'a pas de sens sur une MediaConnection.
                const callType = sanitizeMetadataType(metadata?.type)

                if (!callType || callType === 'data') {
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

                // Authentification: l'appelant doit être un membre autorisé de la room
                // (sinon il recevrait le stream local sans aucune vérification).
                if (!_isAuthorizedIncomingPeer(metadata, call, targetCtx)) {
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
                const waitForLocalStream = (timeoutMs = STREAM_WAIT_TIMEOUT_MS) => {
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

    const _getOpenDataConnection = (room, userSlug, type = 'data') => {
        const roomConnections = ctx.peerStore.getConnections?.[room]?.[userSlug]?.[type] ?? []
        
        if (!Array.isArray(roomConnections) || roomConnections.length === 0) {
            return null
        }

        // cherche une connexion ouverte avec un datachannel actif (fallback conn=null si aucune)
        return roomConnections.find(conn => conn?.open && conn?.chunker) ?? null
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 🔁 forwardStarMessage — utilisée UNIQUEMENT par le hub en topologie star
    //
    // Quand le hub reçoit un message d'un client avec __starRoute: true,
    // il appelle cette fonction pour le retransmettre aux bons destinataires.
    //
    // Paramètres de l'enveloppe :
    //   envelope.from    → champ déclaratif client (non fiable, ignoré côté hub)
    //   envelope.to      → liste de slugs ciblés, ou null pour "tout le monde"
    //   envelope.payload → les vraies données à livrer
    // ─────────────────────────────────────────────────────────────────────────────
    const forwardStarMessage = (envelope, sourceConn = null) => {
        const senderIdentity = sourceConn?.peer ? String(sourceConn.peer) : null
        if (!senderIdentity) {
            console.warn('[Hub] Enveloppe star ignorée: peerId expéditeur introuvable sur la connexion entrante', {
                declaredFrom: envelope?.from,
            })
            return
        }

        const senderSlug = _resolveSenderSlugFromIncomingConn(sourceConn, ctx)
        if (!senderSlug) {
            console.warn('[Hub] Enveloppe star ignorée: expéditeur non résolu depuis la connexion entrante', {
                senderPeerId: sourceConn?.peer,
                declaredFrom: envelope?.from,
            })
            return
        }

        // ── Rate limiting ────────────────────────────────────────────────────────
        // Protection contre les rafales de messages : si un client dépasse
        // HUB_MAX_MESSAGES_PER_WINDOW messages dans HUB_RATE_WINDOW_MS, l'excédent
        // est abandonné pour éviter la saturation du hub.
        if (_isHubRateLimited(senderIdentity)) {
            console.warn(
                `[Hub] Rate limit dépassé (${HUB_MAX_MESSAGES_PER_WINDOW} msg/${HUB_RATE_WINDOW_MS}ms)` +
                ` — message de '${senderSlug}' (${senderIdentity}) abandonné`
            )
            return
        }

        // ── Limite de taille payload (anti-amplification DoS) ─────────────────
        // Types acceptes: JSON + binaire (Blob, File, ArrayBuffer, TypedArray)
        const payloadSize = getPayloadSizeBytes(envelope?.payload)
        if (!payloadSize.ok) {
            console.warn('[Hub] Enveloppe star ignoree: payload invalide', {
                reason: payloadSize.reason,
                senderSlug,
                senderPeerId: senderIdentity,
            })
            return
        }

        if (payloadSize.bytes > MAX_PAYLOAD_BYTES) {
            console.warn(
                `[Hub] Enveloppe star ignoree: payload trop volumineux (${payloadSize.bytes} octets > ${MAX_PAYLOAD_BYTES})`,
                {
                    payloadKind: payloadSize.kind,
                    senderSlug,
                    senderPeerId: senderIdentity,
                }
            )
            return
        }

        const room = ctx.session.onAirRoom
        const type = ctx.session.currentType

        // Membres réels de la room : seule source de vérité pour les destinataires.
        const roomMembers = Array.isArray(ctx.connection.usersInRoom)
            ? ctx.connection.usersInRoom
            : []

        // Si `to` est fourni, on le traite comme une demande de ciblage NON fiable :
        // chaque slug doit avoir un format valide ET appartenir à la room courante.
        // Tout slug forgé / hors room est rejeté silencieusement. Sinon (to absent),
        // on cible tous les membres de la room.
        // Dans les deux cas, on exclut l'expéditeur (inutile de lui renvoyer son propre message).
        let targets
        if (Array.isArray(envelope.to)) {
            targets = envelope.to.filter(slug =>
                _isValidSlug(slug) && roomMembers.includes(slug)
            )
        } else {
            targets = [...roomMembers]
        }
        targets = targets.filter(slug => slug !== senderSlug)

        targets.forEach(userSlug => {
            const conn = _getOpenDataConnection(room, userSlug, type)
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
        const type = ctx.session.currentType

        // ── TOPOLOGIE MESH ──────────────────────────────────────────────────────
        // Chaque peer est connecté à tous les autres → on envoie directement à chacun.
        if (ctx.topology.value === 'mesh') {
            // Limite de taille payload (anti-DoS pair-à-pair) : le même `data` est
            // diffusé à tous les pairs, on contrôle donc la taille une seule fois
            // avant la boucle et on annule entièrement l'envoi si elle dépasse
            // MAX_PAYLOAD_BYTES (JSON + binaire).
            if (!isPayloadWithinLimit(data, '[Mesh]')) return

            const targets = destUserSlugs || ctx.connection.usersInRoom
            targets.forEach(userSlug => {
                const conn = _getOpenDataConnection(room, userSlug, type)
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
                    const conn = _getOpenDataConnection(room, userSlug, type)
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

            const conn = _getOpenDataConnection(room, ctx.hubSlug.value, type)
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