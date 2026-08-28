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
import { markRaw } from 'vue'
import { MAX_PEERS_PER_ROOM, VALID_CONNECTION_TYPES } from '../webrtc2.config.js'
import { isAuthorizedPeer } from './utils/isAuthorizedPeer.js'

export function usePeerConnections(ctx) {

    const inFlightConnections = new Set()

    /**
     * Reconstruit l'annuaire `user_id` → slug depuis la liste de présence BRUTE.
     *
     * Brute et non filtrée : ce n'est pas une allowlist, c'est un dictionnaire d'identités.
     * M'y inclure ne m'autorise rien — `markAnnouncedStream` refuse déjà mon propre slug —
     * et Reverb ne me renvoie jamais mes propres client events.
     *
     * Reconstruit (pas fusionné) : un `user_id` qui n'est plus dans la composition ne doit
     * plus être traduisible, sinon le whisper d'un partant resterait attribuable.
     *
     * Clés en STRING : Reverb repose le `user_id` de la connexion tel quel dans
     * l'enveloppe, et pusher-js ne le convertit pas — comparer un `Number` d'`id` à ce
     * champ échouerait silencieusement.
     */
    const _rebuildSlugDirectory = (users) => {
        ctx.connection.slugByUserId.clear()

        if (!Array.isArray(users)) return

        for (const user of users) {
            if (user?.id === null || user?.id === undefined || !user?.slug) continue
            ctx.connection.slugByUserId.set(String(user.id), user.slug)
        }
    }

    /**
     * Un tour de composition de room : qui vient d'arriver, qui vient de partir.
     *
     * ⚠️ Sans verrou, et ce n'est pas un oubli. Un mutex à chaîne de promesses a vécu ici,
     * censé garder un TOCTOU entre la lecture de la composition précédente et son écriture.
     * Il ne gardait rien : l'unique `await` de cette fonction PRÉCÈDE la lecture, tout ce
     * qui suit est synchrone, et deux appels concurrents ne peuvent donc pas s'entrelacer.
     * L'ordre des tours, lui, est sérialisé un étage au-dessus par la boucle de drain de
     * `useConnectionPool.syncUsersConnections` — seul appelant de production.
     *
     * Deux invariants portent cette absence de verrou, et les défaire la rend fausse :
     * `peerStore.computeRoomDiff` reste synchrone, et rien ne s'insère entre la barrière
     * `waitForMeReady` et l'appel.
     *
     * @param {Array<{id: ?number|string, slug: string}>} users  Liste de présence BRUTE
     * @returns {Promise<{ newUsers: Array<Object>, removedUsers: string[] }>}
     */
    const getRoomUsersDiff = async (users = []) => {
        // ⚠️ AVANT la barrière `waitForMeReady`, et c'est la seule écriture de ce tour qui
        // la précède. Elle ferme une course réelle : un diffuseur re-annonce dès qu'il voit
        // l'arrivant, or l'arrivant ne peut attribuer ce whisper que si son annuaire est
        // écrit — et cette barrière attend le peerId local (jusqu'à ME_READY_TIMEOUT_MS).
        // Un whisper arrivé avant serait rejeté, définitivement : un client event ne se
        // rejoue pas.
        //
        // Écrire tôt ne concède aucun droit : l'annuaire ne fait que traduire un id en
        // slug. La garde d'affichage est ailleurs — `useAwaitedStreams` intersecte les
        // annonces avec `remotePeers`, qui reste, lui, derrière la barrière. Un pair
        // traduit mais pas encore admis est donc noté sans rien afficher.
        _rebuildSlugDirectory(users)

        const ready = await ctx.waitForMeReady()
        if (!ready) {
            return { newUsers: [], removedUsers: [] }
        }

        // Ce tour a-t-il OBSERVÉ quelque chose ? Question distincte de « qui est là », et
        // c'est tout le correctif : synchroniser n'est pas savoir.
        //
        // ⚠️ Mesuré sur la liste BRUTE, avant le filtrage de mon propre slug. Le canal de
        // présence me compte toujours parmi les membres : `[moi]` — le dernier autre pair
        // vient de partir — est une observation valide, alors que sa projection filtrée
        // est vide. Sur la liste filtrée, le seul tour qui apprend « je suis seul »
        // passerait pour un tour qui n'a rien appris.
        //
        // ⚠️ Et `length > 0`, jamais « la liste me contient » : ce tableau est une prop,
        // pas un fait vérifié. Un consommateur qui s'exclurait de sa propre liste ne
        // serait pas fautif, mais son contexte ne déclarerait alors JAMAIS la présence
        // connue — chaque admission entrante paierait le timeout de `waitForPresenceSync`
        // avant de conclure comme elle l'aurait fait tout de suite. Et sans qu'aucun test
        // ne rougisse, le contexte de test naissant déjà `presenceSynced: true`.
        const presenceObserved = users.length > 0

        // `remoteUsers`, pas `remotePeers` : ce sont les OBJETS utilisateur de la liste de
        // présence, pas les slugs de la composition. L'homonymie a déjà coûté une relecture.
        const remoteUsers = users.filter(user => user.slug !== ctx.meStore.getMe.slug)
        const nextSlugs = remoteUsers.map(user => user.slug)

        // Le diff ET l'écriture, en un seul appel. Écrit à TOUS les tours, observation ou
        // non — c'est ce qui rend le dernier partant purgeable : sur une liste vide,
        // `removedSlugs` vaut la composition précédente entière, et c'est le seul tour qui
        // puisse le dire.
        //
        // Une seule case mémoire depuis la migration : `roomMembers[contextId]` porte à la
        // fois l'allowlist du chemin (a) des deux gardes d'autorisation — que
        // `ctx.connection.remotePeers` lit par accesseur — et le prédicat « absent de TOUTES
        // les rooms » de `removeRemotePeerId`. Avant, deux écritures jumelles ici tenaient
        // les deux domiciles synchrones, et rien ne l'aurait signalé si l'une avait sauté.
        const { newSlugs, removedSlugs } = ctx.peerStore.computeRoomDiff(ctx.contextId, nextSlugs)

        // Les arrivants retraduits en objets : c'est ce que la forme publique promet, et le
        // store n'a pas à connaître les objets utilisateur. Filtre sur `remoteUsers` plutôt
        // que `map` sur `newSlugs` pour conserver l'ordre de la liste de présence et le
        // comportement sur doublon.
        const newUsers = remoteUsers.filter(user => newSlugs.includes(user.slug))
        const removedUsers = removedSlugs

        // La liste et la CONNAISSANCE qu'on en a n'avancent plus au même rythme, et c'est
        // le correctif lui-même. L'écrivain, lui, reste unique : l'invariant n'est plus
        // « les deux bougent ensemble », il est « la connaissance n'avance jamais sans la
        // liste ».
        //
        // Un tour qui n'a rien observé synchronise (il purge) mais n'apprend rien. Le
        // déclarer « présence connue » ferait basculer les gardes d'admission de « je ne
        // sais pas encore » à « tu n'es pas membre » sur une ignorance — `_admitIncoming`
        // et `responseRemotePeerConnection` sont le chemin de sécurité.
        //
        // ⚠️ Écrit en DERNIER : ce drapeau réveille les attentes de `waitForPresenceSync`,
        // et ce qu'elles trouvent au réveil doit être complet.
        //
        // ⚠️ Monotone : jamais remis à false ici. `waitForPresenceSync` est mémoïsée et ne
        // résout qu'une fois — un retour à false ne réarmerait aucune attente et
        // fabriquerait un contexte qui se dit « présence inconnue » pendant que sa propre
        // attente répond déjà `true`. Seul `destroy()` le rabaisse, avec la liste.
        if (presenceObserved) {
            ctx.connection.presenceSynced = true
        }

        return { newUsers, removedUsers }
    }

    /**
     * Les connexions stockées pour ce pair, sous ce type, dans cette room.
     * Extrait parce que deux prédicats de sens opposé lisent exactement la même liste.
     */
    const _storedConnections = (userSlug, roomArg = null, typeArg = null) => {
        const room = roomArg || ctx.session.currentCallRoomId || ctx.session.currentRoom
        const type = typeArg || ctx.currentType.value
        const stored = ctx.peerStore.getConnections?.[room]?.[userSlug]?.[type] ?? []
        return { type, list: Array.isArray(stored) ? stored : [] }
    }

    /**
     * Une MediaConnection PeerJS, par opposition à une DataConnection ?
     *
     * ⚠️ Nécessaire parce qu'un contexte `stream` stocke les DEUX sous le même type :
     * `connectToPeer` ouvre l'appel média ET un canal data avec la même `metadata`. Or
     * ce sont deux `RTCPeerConnection` distincts (un négociateur chacun) : le canal data
     * peut très bien s'établir pendant que l'appel média reste sans réponse. Un prédicat
     * qui ne les distingue pas conclurait « flux établi » sur la foi du data channel.
     *
     * `conn.type` est l'API PeerJS ('media' | 'data') ; le repli sur `answer` couvre les
     * doubles de test qui ne le portent pas.
     */
    const _isMediaConnection = (conn) => (
        conn?.type === 'media' || (conn?.type !== 'data' && typeof conn?.answer === 'function')
    )

    /**
     * « La connexion attendue est-elle réellement ÉTABLIE ? »
     *
     * ⚠️ À ne pas confondre avec `hasOpenConnection`, qui répond à une question opposée
     * (« dois-je m'abstenir d'en ouvrir une seconde ? ») et doit rester optimiste. Les
     * deux ont longtemps été un seul prédicat, et c'est ce qui rendait DÉFINITIVE toute
     * défaillance d'admission :
     *
     *   `hasOpenConnection` admet une MediaConnection en `new` / `connecting` — l'état
     *   exact d'un `peer.call()` que le récepteur n'a jamais répondu. Sans réponse, le
     *   `RTCPeerConnection` reste `connecting` À VIE (WebRTC ne le fait pas basculer en
     *   `failed` faute d'answer). Le moteur de retry lisait donc « connexion établie »
     *   une seconde après l'appel, annulait sa surveillance, et l'émetteur n'essayait
     *   plus jamais — écran noir chez le récepteur, sans une seule erreur console.
     *
     * Ici, rien n'est établi tant que le transport ne l'est pas : `open === true` pour un
     * canal data, `connectionState === 'connected'` pour un appel média. Tout le reste —
     * `new`, `connecting`, `peerConnection` illisible — vaut « pas encore ».
     *
     * @returns {boolean}
     */
    const isConnectionEstablished = (userSlug, roomArg = null, typeArg = null) => {
        const { type, list } = _storedConnections(userSlug, roomArg, typeArg)
        if (list.length === 0) return false

        return list.some((conn) => {
            if (!conn) return false
            if (type === 'data') return conn.open === true

            // Sur un type média, seule la MediaConnection fait foi (cf. _isMediaConnection).
            if (!_isMediaConnection(conn)) return false

            // Lecture défensive : le RTCPeerConnection peut être en cours de destruction.
            try {
                return conn.peerConnection?.connectionState === 'connected'
            } catch {
                return false
            }
        })
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

            // MediaConnection PeerJS — lecture défensive : le RTCPeerConnection peut être
            // en cours de destruction au moment de la lecture (TOCTOU inter-ticks).
            try {
                const pc = conn.peerConnection
                if (pc?.connectionState) {
                    return !['closed', 'failed', 'disconnected'].includes(pc.connectionState)
                }

                if (pc?.signalingState) {
                    return pc.signalingState !== 'closed'
                }
            } catch {
                // Objet RTCPeerConnection détruit ou état illisible → connexion considérée fermée
                return false
            }

            // Fallback: connexion considérée active si non explicitement fermée
            return true
        })
    }  

    /**
     * Compte le nombre de peers ayant actuellement une connexion active dans une room
     * (pour le type donné). Utilisé pour enforcer MAX_PEERS_PER_ROOM.
     */
    const _countActivePeersInRoom = (room, type) => {
        const roomConnections = ctx.peerStore.getConnections?.[room]
        if (!roomConnections || typeof roomConnections !== 'object') return 0
        return Object.keys(roomConnections).filter(
            slug => hasOpenConnection(slug, room, type)
        ).length
    }

    const connectToPeer = (payload) => {
        const userSlug = payload?.userSlug || payload?.fromUserSlug
        const peerId = payload?.peerId ? String(payload.peerId) : null

        if (!userSlug || !peerId) {
            console.warn('Connexion peer ignorée: userSlug ou peerId manquant', payload)
            return false
        }

        const room = payload?.room || ctx.session.currentCallRoomId || ctx.session.currentRoom
        // `connectionType` prioritaire sur `type` : sur un signal de signalisation, `type`
        // est le type du CONTEXTE (clé de routage du signal) tandis que `connectionType`
        // porte la connexion réellement demandée — c'est ce qui permet à la signalisation
        // d'ouvrir une connexion 'screen', qu'elle n'ouvrait jamais auparavant.
        // Absent (backend non à jour, appels internes) ⇒ on retombe sur `type`.
        const type = payload?.connectionType || payload?.type || ctx.currentType.value

        const mySlug = ctx.meStore.getMe?.slug
        const myPeerId = String(
            ctx.peerStore.getLocalPeerId
            || ''
        )

        // Garde 1: ne jamais se connecter à soi-même
        if ((mySlug && userSlug === mySlug) || (myPeerId && peerId === myPeerId)) {
            return true
        }

        // Garde 2 : autorisation SORTANTE — membre de la room OU interlocuteur d'appel
        // autorisé (cf. utils/isAuthorizedPeer.js).
        //
        // ⚠️ Placée AVANT `addRemotePeerId` ci-dessous, et c'est la moitié du correctif :
        // ce payload vient de la signalisation, donc de n'importe quel authentifié. Écrire
        // le mapping sans condition laissait un tiers s'inscrire lui-même comme
        // « interlocuteur d'appel vérifié » et empoisonner l'allowlist du chemin (b) de
        // `_isAuthorizedIncomingPeer` — sans qu'aucun appel n'ait jamais été autorisé.
        // L'autre moitié est le `peer.call(attaquant, monFlux)` qui suivait.
        //
        // ⚠️ `false`, jamais `true` : `true` signifie « rien à conclure » et ANNULE le
        // retry, `false` le diffère. Un signal légitime reçu avant que la présence Reverb
        // n'ait peuplé `remotePeers` doit être rattrapé par le moteur de retry, pas perdu.
        //
        // ⚠️ Ce garde ne va PAS dans `useSignalingQueue` : l'absence de précondition au
        // routage est un invariant documenté (un signal abandonné là l'est définitivement).
        if (!isAuthorizedPeer(userSlug, ctx)) {
            console.warn(
                '[usePeerConnections] connectToPeer: pair non autorisé — connexion sortante refusée',
                {
                    userSlug,
                    peerId,
                    room,
                    type,
                    remotePeers: [...(ctx.connection?.remotePeers ?? [])],
                    isAuthorizedCallPeer: ctx.isAuthorizedCallPeer?.(userSlug) === true,
                }
            )
            return false
        }

        // ⚠️ AVANT les gardes, et ce n'est pas cosmétique : ce peerId vient de la
        // signalisation backend (PEER_CONNECT_TO_REMOTE_PEER ou peer-access-permission),
        // il décrit donc l'état COURANT du pair — strictement plus frais que le store,
        // que la connexion s'ouvre ou non derrière. Placé après les gardes, il était
        // perdu à chaque fois qu'on sortait par « déjà connecté » : or `hasOpenConnection`
        // considère ouverte une MediaConnection dont le RTCPeerConnection n'est plus
        // lisible (fallback `return true`), c'est-à-dire précisément le cas d'un pair qui
        // a rechargé sa page. Le store conservait alors l'ancien peerId, plus personne ne
        // redemandait le nouveau — puisqu'on croyait en avoir un — et le pair devenait
        // définitivement injoignable.
        //
        // Symétriquement, la demande en vol de CE contexte est satisfaite : on la retire
        // (clé exacte slug|room|type — jamais celle d'un autre contexte).
        ctx.peerStore.addRemotePeerId(userSlug, peerId)
        ctx.peerStore.removeWaitingRemotePeerId(userSlug, ctx.session.onAirRoom, type)

        // Garde 3: évite les doubles tentatives concurrentes pour la même cible
        const lockKey = room + ':' + type + ':' + userSlug
        if (inFlightConnections.has(lockKey)) {
            return true
        }

        // Acquiert le verrou AVANT hasOpenConnection pour éviter le TOCTOU :
        // la vérification de l'état et l'action (peer.call/connect) sont dans la même
        // section critique — aucun appel concurrent ne peut passer la garde entre les deux.
        inFlightConnections.add(lockKey)

        try {
            // Garde 4 (dans le verrou) : vérifié après acquisition pour que l'état lu
            // et l'action qui suit soient atomiques vis-à-vis des appels concurrents.
            if (hasOpenConnection(userSlug, room, type)) {
                return true
            }

            // Garde 5 : limite du nombre de peers par room en topologie mesh.
            // Compté à l'intérieur du verrou pour que la lecture et la décision
            // soient atomiques vis-à-vis des appels concurrents.
            const activePeerCount = _countActivePeersInRoom(room, type)
            if (activePeerCount >= MAX_PEERS_PER_ROOM) {
                console.warn(
                    `[usePeerConnections] connectToPeer: limite de ${MAX_PEERS_PER_ROOM} peers` +
                    ` atteinte pour la room "${room}" (type: ${type})` +
                    ` — connexion vers "${userSlug}" refusée`,
                    { activePeerCount, room, type, userSlug }
                )
                return false
            }

            const config = _buildPeerConnectionConfig({
                ...payload,
                userSlug,
                peerId,
                type,
                room,
            })

            if (!config) {
                return false
            }

            // Garde 6 : le Peer local existe-t-il vraiment ?
            //
            // ⚠️ Les cinq branches ci-dessous font `ctx.peerStore.getLocalPeer.connect(…)` ou
            // `.call(…)` SANS vérifier la nullité, en s'appuyant sur le fait que l'appelant a
            // *peut-être* attendu `waitForMeReady` — lequel ne teste que `lastLocalPeerId`, un
            // fait HISTORIQUE (cf. `id-historique-sur-peer-inutilisable` dans
            // `peers2/getters.js`). Les deux ne disent pas la même chose : `disconnect()` met
            // `_id` du Peer à null et le `.catch` d'init nulle `localPeer` en laissant
            // `lastLocalPeerId` posé. Dans les deux cas `waitForMeReady` répond oui et il n'y
            // a pas de peer.
            //
            // Sans ce garde, la TypeError tombait dans le `catch` en bas et sortait en
            // « Erreur pendant connectToPeer » — un message qui ne nomme ni la cause ni le
            // pair, sur un chemin dont on sait maintenant qu'il est atteignable en routine.
            //
            // `false` et non `true` : le moteur de retry doit REVENIR. `true` voudrait dire
            // « c'est fait », et le pair resterait injoignable pour de bon.
            if (!ctx.peerStore.getLocalPeer) {
                console.warn(
                    `[usePeerConnections] connectToPeer (${config.options.metadata.type}) :` +
                    ` aucun Peer local — connexion vers "${userSlug}" reportée`,
                    { userSlug, room, type, identity: ctx.peerStore.peerIdentity?.() ?? null }
                )
                return false
            }

            if (config.options.metadata.type === 'data') {
                const conn = ctx.peerStore.getLocalPeer.connect(config.peerId, config.options)
                _saveRoomConnection(config, conn)
                return true
            }

            if (config.options.metadata.type === 'stream') {
                const stream = config.stream
                const isValidStream = stream instanceof MediaStream
                    && stream.getTracks().some(t => t.readyState === 'live')
                // Pas de stream disponible : pas encore streamé, on ignore silencieusement
                if (!isValidStream) {
                    return true
                }
                const call = ctx.peerStore.getLocalPeer.call(config.peerId, stream, config.options)
                _saveRoomConnection(config, call)
                 const conn = ctx.peerStore.getLocalPeer.connect(config.peerId, config.options)
                _saveRoomConnection(config, conn)
                return true
            }

            if (config.options.metadata.type === 'screen') {
                const stream = config.stream
                const isValidStream = stream instanceof MediaStream
                    && stream.getTracks().some(t => t.readyState === 'live')
                if (!isValidStream) return true
                const call = ctx.peerStore.getLocalPeer.call(config.peerId, stream, config.options)
                _saveRoomConnection(config, call)
                return true
            }

            // `visio` ET `vocal` : mêmes préconditions de flux, même ouverture.
            // ⚠️ `vocal` n'avait AUCUNE branche et tombait sur le `return true` final :
            // `peer.call()` n'était jamais appelé, donc aucun flux ne partait — et ce
            // `true` **annulait** le retry, si bien que rien ne rattrapait. Le type était
            // pourtant de première classe partout ailleurs (VALID_CONNECTION_TYPES,
            // `_buildPeerConnectionConfig` qui lui affecte bien un stream,
            // `closePeerConnection`, `normalizeType`) : seule l'ouverture manquait.
            const metadataType = config.options.metadata.type
            if (metadataType === 'visio' || metadataType === 'vocal') {
                const stream = config.stream
                const isValidStream = stream instanceof MediaStream
                    && stream.getTracks().some(t => t.readyState === 'live')
                if (!isValidStream) {
                    console.warn(`[usePeerConnections] connectToPeer (${metadataType}): stream local absent ou invalide — peer.call() annulé`, {
                        userSlug,
                        stream: stream ?? null,
                    })
                    return false
                }
                const call = ctx.peerStore.getLocalPeer.call(config.peerId, stream, config.options)
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

            // Ce contexte ferme cette room : ses demandes en vol pour ce pair n'ont plus
            // d'objet. Portée limitée à `currentRoom` — les demandes des AUTRES contextes
            // (autre room, même pair) leur appartiennent et doivent survivre.
            ctx.peerStore.clearWaitingRemotePeerIds(userSlug, currentRoom)
        })

        if (clearSignalQueue) {
            ctx.peerStore.clearSignalQueueRoom(ctx.contextId)
        }
    }

    const _buildPeerConnectionConfig = (payload) => {
        const peerId = payload?.peerId ? String(payload.peerId).trim() : ''
        const userSlug = payload?.userSlug ? String(payload.userSlug).trim() : ''
        const type = payload?.type ? String(payload.type).trim() : ''
        const room = payload?.room ? String(payload.room).trim() : ''
        const me = ctx.meStore.getMe

        if (!peerId) {
            console.warn('[usePeerConnections] _buildPeerConnectionConfig: peerId manquant ou vide', payload)
            return null
        }
        if (!userSlug) {
            console.warn('[usePeerConnections] _buildPeerConnectionConfig: userSlug manquant ou vide', payload)
            return null
        }
        if (!VALID_CONNECTION_TYPES.has(type)) {
            console.warn('[usePeerConnections] _buildPeerConnectionConfig: type de connexion invalide', { type, validTypes: [...VALID_CONNECTION_TYPES] })
            return null
        }
        if (!room) {
            console.warn('[usePeerConnections] _buildPeerConnectionConfig: room manquante ou vide', payload)
            return null
        }
        if (!me?.slug) {
            console.warn('[usePeerConnections] _buildPeerConnectionConfig: meStore.getMe null ou slug absent')
            return null
        }

        const config = {
            peerId,
            options: {
                metadata: {
                    slug: userSlug,
                    from: String(me.slug),
                    fromName: String(me.name ?? ''),
                    type,
                    room,
                    callbackKey: ctx.contextId,
                    isAudioMuted: ctx.ui.streamStates.isMuted,
                    isVideoEnabled: ctx.ui.streamStates.isVideoEnabled,
                }
            }
        }

        if (type === 'data') {
            // Whether the underlying data channels should be reliable (e.g. for large file transfers)
            // or not (e.g. for gaming or streaming).
            config.options.reliable = true
        } else if (type === 'screen') {
            config.stream = ctx.media.screenStream
        } else if (
            type === 'stream'
            || type === 'visio'
            || type === 'vocal'
        ) {
            config.stream = ctx.media.currentStream
        }

        return config
    }

    const _saveRoomConnection = (config, connection) => {
        ctx.peerStore.prepareRoomConnection(config)
        ctx.setUpConnectionListeners(connection)
        _storeRoomConnection(config, markRaw(connection))
    }

    const _storeRoomConnection = (config, connection) => {
        ctx.peerStore.storePeerConnection(
            config.options.metadata.room,
            config.options.metadata.slug,
            config.options.metadata.type,
            connection
        )
    }

    // ⚠️ Le routage des signaux entrants (PEER_CONNECT_TO_REMOTE_PEER → connectToPeer)
    // vit dans useSignalingQueue. Conséquence : ce composable n'enregistre plus aucun
    // hook de lifecycle Vue — ne pas en réintroduire ici sans raison (il reste
    // instanciable et testable hors setup()).

    return {
        getRoomUsersDiff,
        hasOpenConnection,
        isConnectionEstablished,
        connectToPeer,
        closePeerConnection,
    }
}