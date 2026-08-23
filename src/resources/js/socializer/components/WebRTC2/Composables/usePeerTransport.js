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
    HUB_MAX_BYTES_PER_WINDOW,
    MAX_PAYLOAD_BYTES,
    PEER_DESTROY_DELAY_MS, 
    RECONNECT_BASE_DELAY_MS, 
    RECONNECT_MAX_DELAY_MS, 
    SLUG_PATTERN,
    STREAM_WAIT_TIMEOUT_MS } from '../webrtc2.config.js'
import { getPayloadSizeBytes, isPayloadWithinLimit } from './utils/payloadSize.js'
import { sanitizeMetadataType } from './utils/sanitizeMetadata.js'
import { createRateLimiter } from './utils/createRateLimiter.js'
import { isAuthorizedPeer } from './utils/isAuthorizedPeer.js'

// -----------------------------------------------------------------------------
// Registre global des contextes WebRTC actifs
// key = contextId (ex: data-room-test, stream-room-test)
// value = ctx complet (avec setUpConnectionListeners)
// -----------------------------------------------------------------------------
const contextRegistry = new Map()

// -----------------------------------------------------------------------------
// ⚠️ L'état du Peer singleton (compteur de consommateurs, promesse d'init,
// tentatives de reconnexion, handles des deux timers) N'EST PAS ici : il vit dans
// `peerStore` (cf. stores/peers2/state.js, section « Runtime du Peer singleton »).
//
// Raison : le module ES et le store n'ont pas la même durée de vie. Un HMR recharge
// ce module — compteurs remis à zéro — mais pas le store, où le Peer est toujours
// vivant : la copie neuve ne voyait plus les consommateurs montés, le premier
// démontage faisait tomber le compte à 0 et détruisait un peer encore utilisé
// (`lastLocalPeerId` à null ⇒ `waitForMeReady` abandonne au bout de 15 s ⇒ un
// arrivant ne reçoit jamais le flux). Symétriquement, une init en vol n'était plus
// visible et une seconde instance Peer était créée, la première fuyant avec un
// peerId fantôme encore enregistré côté serveur PeerJS.
//
// Ce qui RESTE volontairement au niveau du module :
//   - `contextRegistry` ci-dessus : registre d'objets de contexte, pas de l'état
//     du peer ; les tests l'isolent par `vi.resetModules()`.
//   - `_hubRateLimiter` plus bas : fenêtre glissante du hub, dont l'arbitrage
//     (verbe `.reset()` plutôt qu'une migration Pinia) est acté dans la TODOLIST.
// -----------------------------------------------------------------------------

function _schedulePeerDestroy(peerStore) {
    // Annule tout timer en cours (ne pas empiler des destructions)
    peerStore.clearPeerDestroyTimer()

    if (PEER_DESTROY_DELAY_MS <= 0) {
        _destroyPeerSingleton(peerStore)
        return
    }

    console.info(
        `[WebRTC2] Dernier consommateur parti — destruction du Peer dans ${PEER_DESTROY_DELAY_MS}ms` +
        ` (annulable si un composant remonte avant)`
    )
    peerStore.peerDestroyTimer = setTimeout(() => {
        peerStore.peerDestroyTimer = null
        _destroyPeerSingleton(peerStore)
    }, PEER_DESTROY_DELAY_MS)
}

function _destroyPeerSingleton(peerStore) {
    // Cas résiduel : _destroyPeerSingleton peut être appelé après un échec
    // d'initialisation (catch de peerInitPromise) où localPeer a déjà été remis
    // à null. Dans ce cas, le compteur de consommateurs reflète encore les
    // consommateurs actifs (leurs onUnmounted décrémentent normalement jusqu'à 0)
    // — d'où `keepConsumerCount`, sans quoi le comptage serait faussé pour un
    // éventuel retry.
    if (!peerStore.localPeer) {
        // Rien à détruire ; le reset annule aussi le timer de reconnexion par précaution.
        peerStore.resetPeerState({ keepConsumerCount: true })
        console.info('[WebRTC2] _destroyPeerSingleton: peer déjà absent (échec init ou double-appel), skip')
        return
    }

    // ⚠️ AVANT `destroy()`, et ce n'est pas de la précaution : vérifié dans peerjs 1.5.4
    // (`dist/bundler.mjs`), `destroy()` ne retire QUE les listeners de son socket interne
    // (`socket.removeAllListeners()`, l.1789) — les nôtres, posés sur le `Peer`, survivent.
    // Et il appelle `disconnect()`, qui **émet `disconnected`** (l.1810) alors que le drapeau
    // `_destroyed` n'est posé qu'ensuite (l.1781) : le garde `localPeer.destroyed` du handler
    // de reconnexion ne voyait donc rien, et une destruction volontaire était traitée comme
    // une coupure réseau — tentative consommée, faux « tentative n/8 », faux « abandon » au
    // plafond, et surtout `peerReconnectTimer` ÉCRASÉ : un backoff déjà en vol devenait un
    // timer orphelin que le `resetPeerState` ci-dessous ne pouvait plus annuler.
    peerStore.detachPeerListeners()

    try {
        if (!peerStore.localPeer.destroyed) {
            peerStore.localPeer.destroy()
        }
    } catch (e) {
        console.warn('[WebRTC2] Erreur lors de la destruction du Peer singleton :', e)
    }
    peerStore.resetPeerState()
    console.info('[WebRTC2] Peer singleton détruit')
}

// ─── Rate limiting hub (topologie star) ─────────────────────────────────────
// Fenêtre glissante par expéditeur, clé = senderIdentity (peerId PeerJS entrant
// RÉEL, jamais `envelope.from` auto-déclaré — cf. faille [HAUTE] de SECURITY_AUDIT).
// Partagé entre contextes car le hub est unique.
const _hubRateLimiter = createRateLimiter({
    windowMs: HUB_RATE_WINDOW_MS,
    max: HUB_MAX_MESSAGES_PER_WINDOW,
})

// Second plafond, MÊME CLÉ, même mécanique en mode pondéré : celui-ci compte les
// octets réellement retransmis (`payload × destinataires`) et non les messages.
// Deux instances plutôt qu'un plafond composite, parce que les deux fenêtres se
// vident indépendamment — et parce qu'un refus doit pouvoir dire lequel a mordu.
const _hubByteLimiter = createRateLimiter({
    windowMs: HUB_RATE_WINDOW_MS,
    max: HUB_MAX_BYTES_PER_WINDOW,
})

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
//   3. Anti-usurpation, sur LES DEUX chemins — si l'identité PeerJS réelle de la
//      connexion est déjà résolue à un slug connu (via le mapping global), ce slug
//      doit être `metadata.from`, sinon rejet. Si elle n'est résolue à AUCUN slug,
//      l'admission est accordée mais dite NON CORROBORÉE, et tracée : sur le chemin
//      présence, le mapping du récepteur n'est écrit que lorsque c'est LUI qui ouvre
//      (connectToPeer), donc il est structurellement absent quand l'appel entrant
//      arrive le premier — refuser sur « non résolu » fermerait toute diffusion en
//      room (mesuré par scenarios/incomingMappingInvariant.test.js).
//      Cette règle n'est PAS une défense-en-profondeur : c'est le seul anti-usurpation
//      du chemin (a), qui n'exige rien d'autre qu'un slug déclaré présent dans
//      `usersInRoom`. La corroboration autoritative appartient au backend (lot C).
//
// Important : `ctx.session.currentCallUsers` n'est PAS consulté ici. C'est un état UI
// (qui voir/raccrocher) alimenté à partir de la même signalisation, mais réutiliser un
// état applicatif comme allowlist de sécurité couple politique et affichage et laisse
// passer une connexion entrante avant que le mapping peerId ne soit prêt.
//
// `options.quiet` — évalue sans rien journaliser. Réservé à `_admitIncoming`, qui
// interroge ce prédicat une première fois avant de savoir s'il peut conclure : un refus
// provisoire n'est pas un refus, et le journaliser doublerait la décision finale.
function _isAuthorizedIncomingPeer(metadata, conn, ctx, { quiet = false } = {}) {
    const declaredFrom = metadata?.from
    const warn = quiet ? () => {} : console.warn
    const debug = quiet ? () => {} : console.debug

    if (!_isValidSlug(declaredFrom)) {
        warn(
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
        warn(
            "[WebRTC2] Connexion entrante refusée: émetteur ni membre de la room ni interlocuteur autorisé (mapping peerId absent/non concordant)",
            { declaredFrom, senderPeerId, usersInRoom, hasMappedPeerId: !!mappedPeerId }
        )
        return false
    }

    // Anti-usurpation — inconditionnelle : le peerId réel de la connexion ne doit être
    // résolu à AUCUN autre slug, quel que soit le chemin qui a admis. Le chemin (b)
    // vérifie déjà `mappedPeerId === senderPeerId` dans le sens slug → peerId ; la
    // résolution inverse ferme le cas où ce même peerId est aussi mappé à un autre slug.
    const resolvedSlug = _resolveSenderSlugFromIncomingConn(conn, ctx)
    if (resolvedSlug && resolvedSlug !== declaredFrom) {
        warn(
            '[WebRTC2] Connexion entrante refusée: usurpation détectée (peerId réel ≠ `from` déclaré)',
            { declaredFrom, resolvedSlug, senderPeerId }
        )
        return false
    }

    // Admission non corroborée : rien ne rattache ce peerId à `declaredFrom` — le slug
    // déclaré est la seule identité disponible. C'est le cas NOMINAL du chemin présence
    // (cf. règle 3), pas une anomalie : trace de niveau debug, jamais un refus. Elle
    // mesure la surface qu'un contrôle backend (lot C) devra couvrir.
    if (!resolvedSlug) {
        debug(
            '[WebRTC2] Admission entrante non corroborée: peerId entrant résolu à aucun slug',
            { declaredFrom, senderPeerId, path: isRoomMember ? 'presence' : 'direct-call' }
        )
    }

    return true
}

/**
 * `_isAuthorizedIncomingPeer`, mais qui ne conclut jamais sur une ignorance.
 *
 * Le chemin (a) du garde lit `usersInRoom` : tant que le contexte n'a pas synchronisé sa
 * présence, cette liste est vide et le garde refuse TOUT — y compris le `peer.call` qui
 * apporte son flux à un arrivant. Or ce refus-là est définitif dans les deux sens : la
 * MediaConnection refusée n'est notifiée à personne (PeerJS ne signale pas le `close()`
 * d'un appel jamais répondu) et l'émetteur, lui, voit un `peerConnection` en
 * `connecting` — donc `hasOpenConnection` vrai, donc son moteur de retry s'arrête. Le
 * récepteur reste sur un écran noir, sans une seule erreur console.
 *
 * On attend donc la première synchronisation de présence AVANT de refuser, jamais avant
 * d'admettre : le chemin (b) (appel direct au mapping concordant) n'a pas besoin de la
 * présence et n'est pas ralenti d'une microtâche — ce qui laisse la visio intacte, et
 * `data-app` (aucun canal de présence, que des appels directs) avec elle.
 *
 * ⚠️ Renvoie un **booléen** quand la décision est immédiate, une **promesse** seulement
 * dans le cas différé. C'est délibéré : un `async` inconditionnel repousserait
 * `setUpConnectionListeners` d'une microtâche sur TOUS les chemins, alors que le
 * dispatcher entrant est le point où l'ordre d'exécution est le plus observable.
 * L'appelant écrit donc `if (typeof v !== 'boolean') v = await v`.
 *
 * @returns {boolean|Promise<boolean>}
 */
function _admitIncoming(metadata, conn, ctx) {
    // Présence connue : le garde a toute l'information, il tranche — et il journalise.
    if (ctx?.connection?.presenceSynced) {
        return _isAuthorizedIncomingPeer(metadata, conn, ctx)
    }

    // Présence inconnue. Une admission reste possible sans elle (chemin (b)) ; un refus,
    // non — il ne serait qu'une ignorance déguisée. Silencieux : la décision n'est pas
    // encore prise, la journaliser ici doublerait celle d'après l'attente.
    if (_isAuthorizedIncomingPeer(metadata, conn, ctx, { quiet: true })) return true

    return (ctx?.waitForPresenceSync?.() ?? Promise.resolve(false))
        .then(() => _isAuthorizedIncomingPeer(metadata, conn, ctx))
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
            if (ctx.peerStore.removePeerConsumer() <= 0) {
                _schedulePeerDestroy(ctx.peerStore)
            }
        }
    })

    const setLocalPeer = async () => {

        const peerStore = ctx.peerStore

        // Chaque contexte s'enregistre, même si le peer singleton existe déjà.
        registerContext(ctx)

        // Comptabiliser ce contexte comme consommateur du singleton (une seule fois).
        // Le peer ne sera physiquement détruit que quand TOUS les consommateurs
        // auront appelé onUnmounted(), évitant ainsi les crashes croisés.
        // Si un timer de destruction différée est en cours (PEER_DESTROY_DELAY_MS),
        // l'annuler : le peer existant est réutilisé sans recréation.
        if (!_isRegisteredAsConsumer) {
            _isRegisteredAsConsumer = true
            peerStore.addPeerConsumer()
            if (peerStore.clearPeerDestroyTimer()) {
                console.info('[WebRTC2] Destruction du Peer annulée — nouveau consommateur enregistré')
            }
        }

        // Le peer local est déjà prêt: rien à recréer, mais le contexte est bien enregistré.
        if(peerStore.localPeerReady) return

        // Init EN VOL : le Peer existe déjà, mais son `'open'` n'est pas encore arrivé.
        //
        // ⚠️ Ce garde porte sur l'INSTANCE, et il est indispensable : les deux gardes
        // voisines laissent une fenêtre de plusieurs centaines de ms grande ouverte. Le
        // corps de `_doInit` ne contient aucun `await`, donc `peerInitPromise` est résolue —
        // et remise à `null` par son `finally` — ~3 microtâches après l'appel, alors que
        // `localPeerReady` attend un aller-retour réseau (`retrieveId` HTTP + WebSocket).
        // Or la production monte précisément deux consommateurs dans cet intervalle :
        // `Notifications.vue` crée le contexte permanent `data-app` au tick 0, et le
        // contexte `stream-<room>` arrive après la résolution de route et un import
        // dynamique. Sans ce garde, le second créait un SECOND Peer : le premier restait
        // enregistré côté serveur PeerJS (peerId fantôme), débranché de ses listeners par
        // `setPeerListenersDetach`, et hors d'atteinte de `_destroyPeerSingleton` qui n'agit
        // que sur `peerStore.localPeer`. Symptôme : « A diffuse, B reste sur le spinner »,
        // avec un `Could not connect to peer <uuid>` sur le peerId fantôme.
        if (peerStore.localPeer && !peerStore.localPeer.destroyed) return

        // Guard contre la race condition : 2 composants peuvent passer simultanément
        // (ex: DataRoom + StreamRoom au montage). Le premier crée la promesse d'init,
        // le second attend la même plutôt que de créer un second Peer.
        if (peerStore.peerInitPromise) return peerStore.peerInitPromise

        const _doInit = async () => {
            const peer = markRaw(new Peer({
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
            peerStore.localPeer = peer

            // ── Branchement des listeners du Peer ─────────────────────────────────
            // `bind` est la SEULE porte d'entrée : il enregistre la paire (event, handler)
            // en même temps qu'il l'installe, donc un 6e listener ajouté ici est détaché
            // d'office — on ne peut plus oublier son `off`. Le détachement est stocké dans
            // `peerStore` (cf. state.js) : c'est un AUTRE contexte, voire une autre copie du
            // module après un HMR, qui détruira ce peer.
            //
            // Bindés sur la const `peer`, jamais sur `peerStore.localPeer` : la closure doit
            // viser l'instance qu'elle a réellement bindée. Relire le store au moment du
            // `off` détacherait les listeners du peer COURANT — après un cycle
            // destroy → init, ceux du nouveau. Les CORPS de handlers, eux, continuent
            // volontairement de lire `peerStore.localPeer` : leurs gardes signifient « le
            // store a-t-il encore un peer », pas « ce peer-ci ».
            const bound = []
            const bind = (event, handler) => {
                bound.push([event, handler])
                peer.on(event, handler)
            }

            // Enregistrée AVANT les `bind` : `bound` est capturé par référence, donc même une
            // exception au milieu du branchement laisse de quoi détacher ce qui a été posé.
            peerStore.setPeerListenersDetach(() => {
                while (bound.length > 0) {
                    const [event, handler] = bound.pop()
                    peer.off(event, handler)
                }
            })

            // a la création du Peer
            bind('open', id => {
                // Garde d'identité : n'écrire l'état du singleton que si CE peer est bien
                // celui que le store publie. Un peer supplanté (double init) ou détruit ne
                // doit pas déclarer la session prête ni publier son identité — c'est
                // exactement ce qui a produit la régression « A diffuse, B reste sur le
                // spinner » : `lastLocalPeerId` désignait un peer que plus personne ne
                // pouvait joindre. Ceinture du garde d'instance de `setLocalPeer`.
                if (peerStore.localPeer !== peer) return

                // Peer utilisable : connexion (re)établie avec le serveur PeerJS.
                // localPeerReady passe à true ici (et non plus au début de _doInit)
                // pour refléter l'état réel : le peer n'est utilisable qu'une fois
                // l'événement 'open' reçu. Idempotent sur les reconnexions.
                peerStore.localPeerReady = true
                // Connexion (re)établie : réinitialise le compteur de reconnexion
                peerStore.resetReconnectAttempts()
                // Workaround for peer.reconnect deleting previous id
                if (id === null) {
                    peer.id = peerStore.lastLocalPeerId
                } else {
                    peerStore.lastLocalPeerId = id
                }
            })

            bind('error', (err) => {
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

                // Recherche inverse peerId → userSlug, UNE FOIS, avant toute mutation.
                //
                // ⚠️ Elle vivait à l'intérieur de la boucle, et c'était une impasse : le
                // mapping slug → peerId est partagé par tout l'onglet, si bien que le
                // PREMIER contexte itéré l'invalidait et que tous les suivants sortaient
                // aussitôt sur `if (!targetSlug) return`. La recovery ne profitait donc
                // jamais qu'à un seul contexte — et en production c'est le mauvais :
                // `Notifications.vue` crée `data-app` au tick 0, il est donc premier dans
                // le registre (Map, ordre d'insertion), il absorbait la relance, et le
                // contexte de diffusion — le seul concerné — n'était jamais relancé.
                // Symptôme exact : « Could not connect to peer <uuid> » une seule fois,
                // puis plus rien, et un flux qui n'arrive jamais.
                let targetSlug = null
                for (const registeredCtx of contextRegistry.values()) {
                    for (const [slug, peerId] of (registeredCtx.peerStore.remotePeersId?.entries?.() ?? [])) {
                        if (String(peerId) === String(failedPeerId)) {
                            targetSlug = slug
                            break
                        }
                    }
                    if (targetSlug) break
                }
                if (!targetSlug) return

                contextRegistry.forEach((registeredCtx) => {
                    const room = registeredCtx.session.currentCallRoomId || registeredCtx.session.currentRoom

                    // 1. Retirer les connexions échouées du store (libère le guard
                    //    hasOpenConnection, dont le fallback considère « ouverte » une
                    //    MediaConnection sans peerConnection exploitable).
                    //    ⚠️ Balayer aussi 'screen' : un partage d'écran est stocké sous ce
                    //    type, jamais sous session.currentType — on ne le trouvait donc
                    //    jamais, et sa connexion morte bloquait le retry.
                    const types = new Set([registeredCtx.session.currentType, 'screen'])
                    types.forEach((type) => {
                        const conns = [...(registeredCtx.peerStore.getConnections?.[room]?.[targetSlug]?.[type] ?? [])]
                        conns
                            .filter(conn => conn?.peer === String(failedPeerId))
                            .forEach(conn => {
                                registeredCtx.peerStore.removePeerConnectionInstance(room, targetSlug, type, conn)
                            })
                    })

                    // 2. Invalider le peerId mort pour forcer une nouvelle demande de
                    //    signalisation.
                    //    ⚠️ Inconditionnel, et SANS exiger d'avoir retrouvé une connexion
                    //    stockée : `peer.call()` peut échouer avant l'enregistrement, et
                    //    l'ancien garde `failedConns.length === 0` abandonnait alors avant
                    //    toute invalidation. Le peerId restait « collant » et le pair
                    //    devenait définitivement injoignable (cf. invalidateRemotePeerId,
                    //    qui explique pourquoi removeRemotePeerId ne convient pas ici).
                    registeredCtx.peerStore.invalidateRemotePeerId(targetSlug)

                    // 3. Relancer le cycle — mais SEULEMENT dans les contextes qui ont
                    //    quelque chose à faire de ce pair.
                    //
                    // ⚠️ L'invalidation ci-dessus est globale, la relance ne l'est pas, et
                    // la dissymétrie est voulue : un peerId mort est un fait sur l'ONGLET
                    // distant (le store est partagé), tandis que « redemander son peerId »
                    // est une intention qui appartient à un contexte.
                    //
                    // Sans ce filtre, chaque contexte de l'onglet redemandait — y compris
                    // le `data-app` de Notifications.vue, qui n'a AUCUN canal de présence
                    // (il ne sert qu'aux appels directs) et ne peut donc être autorisé par
                    // personne en face. Résultat : des POST /ask-to-peer-id inutiles et un
                    // « demandeur non autorisé » parfaitement légitime chez le
                    // destinataire, qui noyait les refus qui, eux, veulent dire quelque
                    // chose.
                    //
                    // Le prédicat est celui des deux autres sorties du contexte
                    // (utils/isAuthorizedPeer.js) : membre de la room OU interlocuteur
                    // d'appel autorisé. C'est ce second chemin qui préserve la recovery
                    // d'une visio 1-à-1, laquelle n'a précisément aucune room commune.
                    if (!isAuthorizedPeer(targetSlug, registeredCtx)) return

                    // usePeerOrchestrator observe ce signal via watch() → pas de couplage par mutation.
                    if (registeredCtx.peerUnavailableSignal) {
                        registeredCtx.peerUnavailableSignal.value = targetSlug
                    }
                })
            })

            bind('disconnected', () => {
                // Guard : ne reconnecter que si CE peer est encore celui du store, et qu'il
                // n'est pas détruit. La comparaison d'identité (plutôt qu'un simple test de
                // nullité) évite qu'un peer supplanté relance un backoff pour le compte du
                // peer courant, en écrasant au passage son handle de timer.
                if (peerStore.localPeer !== peer || peer.destroyed) return

                // Guard auto-reconnect infinie : abandon après MAX_RECONNECT_ATTEMPTS
                if (peerStore.peerReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.error(
                        `[WebRTC2] PeerJS: serveur injoignable après ${MAX_RECONNECT_ATTEMPTS} tentatives — abandon.`
                    )
                    return
                }

                const attempt = peerStore.incrementReconnectAttempts()

                // Backoff exponentiel : BASE · BASE*2 · BASE*4 … plafonné à MAX_DELAY
                const delayMs = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1), RECONNECT_MAX_DELAY_MS)

                console.warn(
                    `[WebRTC2] PeerJS déconnecté — tentative ${attempt}/${MAX_RECONNECT_ATTEMPTS} dans ${delayMs}ms`
                )

                peerStore.peerReconnectTimer = setTimeout(() => {
                    // Le handle ne mène plus nulle part : le remettre à null évite qu'un
                    // `clearReconnectTimer` ultérieur porte sur un timer déjà consommé et
                    // que le champ prétende qu'un backoff est en vol.
                    peerStore.peerReconnectTimer = null
                    if (peerStore.localPeer !== peer || peer.destroyed) return
                    // Workaround for peer.reconnect deleting previous id
                    peer.id = peerStore.lastLocalPeerId
                    peer._lastServerId = peerStore.lastLocalPeerId
                    peer.reconnect()
                }, delayMs)
            })

            // ---------------------------------------------------------------------
            // Dispatcher global entrant: DataConnection
            // ---------------------------------------------------------------------
            bind('connection', async (conn) => {
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
                let admitted = _admitIncoming(metadata, conn, targetCtx)
                if (typeof admitted !== 'boolean') admitted = await admitted

                if (!admitted) {
                    try { conn.close() } catch (e) { /* ignore */ }
                    return
                }

                targetCtx.setUpConnectionListeners(conn)
            })

            // ---------------------------------------------------------------------
            // Dispatcher global entrant: MediaConnection (call stream/screen)
            // ---------------------------------------------------------------------
            bind('call', async (call) => {
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
                let admitted = _admitIncoming(metadata, call, targetCtx)
                if (typeof admitted !== 'boolean') admitted = await admitted

                if (!admitted) {
                    try { call.close() } catch (e) { /* ignore */ }
                    return
                }

                const getLocalStream = () => targetCtx.media?.currentStream || null
                const getLocalScreenStream = () => targetCtx.media?.screenStream || null
                const isOneWay = callType === 'stream' || callType === 'screen'

                if (isOneWay) {
                    // Trace exacte « un flux de ce pair est en route » : un appel one-way
                    // n'est émis que si l'émetteur a un flux vivant (cf. connectToPeer), et
                    // cet événement arrive dès la réception de l'offre — avant ICE, donc
                    // avant le `stream`. C'est ce qui couvre la fenêtre « A diffuse déjà,
                    // B arrive » que l'annonce data channel ne peut pas couvrir (le canal
                    // data naît avec l'appel). `metadata.from` est authentifié juste au-dessus
                    // par _isAuthorizedIncomingPeer : sur un appel ENTRANT c'est bien le
                    // distant, et il ne peut pas être le slug d'un autre membre.
                    targetCtx.markAnnouncedStream?.(metadata?.from, 'call')

                    // 'screen' : strictement unidirectionnel par connexion. Si le récepteur
                    // partage lui aussi son écran, il initie sa propre peer.call séparée.
                    // Répondre avec currentStream (webcam) injecterait B-webcam dans la
                    // connexion 'screen' du caller → doublon avec la connexion 'visio'
                    // déjà active (remoteStreamsMap aurait `B-visio` ET `B-screen`
                    // pointant sur le même MediaStream).
                    const answerStream = callType === 'screen'
                        ? (getLocalScreenStream() || undefined)
                        : (getLocalStream() || undefined)
                    call.answer(answerStream)
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

        const initPromise = _doInit()
            .catch(err => {
                // En cas d'échec : localPeerReady est encore false (on('open') n'a
                // pas été reçu), localPeer est remis à null pour permettre un retry.
                // Le compteur de consommateurs N'EST PAS remis à 0 ici : les
                // consommateurs actifs (composants montés) doivent continuer à
                // décrémenter normalement via onUnmounted — les remettre à 0 ici
                // créerait un décalage si un nouveau composant s'enregistre avant que
                // les anciens démontent, pouvant déclencher la destruction d'un peer
                // valide. _destroyPeerSingleton gère explicitement le cas localPeer=null
                // (resetPeerState avec keepConsumerCount).
                // ⚠️ Pas de resetPeerState ici : il nullerait aussi lastLocalPeerId,
                // dont dépend waitForMeReady.
                console.error('[WebRTC2] Échec d\'initialisation du Peer :', err)
                peerStore.localPeerReady = false
                peerStore.localPeer = null
            })
            .finally(() => {
                // Ne nettoyer que SA propre promesse : maintenant qu'elle est partagée par
                // le store, une init tardive (cycle destroy → nouvelle init pendant que
                // l'ancienne est encore en vol) effacerait la garde de la plus récente et
                // laisserait un troisième consommateur créer un second Peer.
                if (peerStore.peerInitPromise === initPromise) {
                    peerStore.setPeerInitPromise(null)
                }
            })

        peerStore.setPeerInitPromise(initPromise)
        return initPromise
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

    /**
     * Slugs de la room joignables MAINTENANT par le data channel.
     *
     * Exposé parce que `sendData` warne par destinataire injoignable : un appelant dont
     * l'envoi est opportuniste (annonce de diffusion) doit pouvoir se taire au lieu de
     * remplir la console sur un chemin normal. En star, la seule connexion d'un client
     * est celle du hub — la liste vaut donc « ai-je un canal du tout ? ».
     *
     * @returns {string[]}
     */
    const getDataReachablePeers = () => {
        const room = ctx.session.onAirRoom
        const type = ctx.session.currentType
        const users = Array.isArray(ctx.connection.usersInRoom) ? ctx.connection.usersInRoom : []

        return users.filter(userSlug => !!_getOpenDataConnection(room, userSlug, type))
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
        if (_hubRateLimiter.isLimited(senderIdentity)) {
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

        // Rien à retransmettre : ne pas consommer de budget pour un fan-out vide.
        if (targets.length === 0) {
            return
        }

        // ── Budget d'octets agrégé (anti-amplification) ──────────────────────────
        // Les deux gardes ci-dessus sont par expéditeur et par message ; leur PRODUIT
        // par le fan-out ne l'était pas — à 100 membres, 20 msg/s × 64 Ko font sortir
        // ~128 Mo/s d'un onglet navigateur. Le coût réel d'une retransmission est
        // `octets × destinataires`, et c'est ce coût qui est plafonné, sur la même clé.
        //
        // ⚠️ Un message coupé ici a déjà consommé un jeton du plafond de messages : la
        // tentative est réelle, elle compte. Et le contrôle porte sur le total déjà
        // dépensé (cf. `createRateLimiter`), donc un premier fan-out coûteux passe et
        // consomme sa fenêtre — c'est l'amplification soutenue qui est visée.
        const fanoutCost = payloadSize.bytes * targets.length

        if (_hubByteLimiter.isLimited(senderIdentity, fanoutCost)) {
            console.warn(
                `[Hub] Budget d'octets dépassé (${HUB_MAX_BYTES_PER_WINDOW} o/${HUB_RATE_WINDOW_MS}ms)` +
                ` — message de '${senderSlug}' (${senderIdentity}) abandonné`,
                {
                    payloadBytes: payloadSize.bytes,
                    targets: targets.length,
                    fanoutCost,
                }
            )
            return
        }

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
        getDataReachablePeers,
        forwardStarMessage,
    }
}