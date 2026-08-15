import { toRaw } from 'vue'
import { isEmpty } from '~estarter/services/helpers.js'
import { waitingPeerIdKey } from '~socializer/stores/peers2/keys.js'

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

    /*--------------------------
    | Runtime du Peer singleton
    |
    | Ref-counting, garde d'init et reconnexion du `localPeer`. Ces verbes sont appelés
    | exclusivement par usePeerTransport ; ils vivent ici pour que l'état suive celui du
    | peer (cf. commentaire de state.js).
    --------------------------*/

    /** Un contexte de plus consomme le peer singleton. @returns {number} nouveau compte */
    addPeerConsumer() {
        this.peerConsumerCount += 1
        return this.peerConsumerCount
    },
    /**
     * Un consommateur se démonte. Plancher à 0 comme `endShutdown` de createPeerContext :
     * un décrément orphelin ne doit pas rendre le compteur négatif, sinon la destruction
     * du peer ne serait plus jamais planifiée au bon moment.
     *
     * @returns {number} nouveau compte — l'appelant planifie la destruction à 0
     */
    removePeerConsumer() {
        this.peerConsumerCount = Math.max(0, this.peerConsumerCount - 1)
        return this.peerConsumerCount
    },

    /**
     * Promesse d'initialisation en vol, partagée par tous les contextes.
     *
     * Une `Promise` traverse le state réactif sans dommage : Vue ne proxifie que les
     * objets nus et les collections, jamais une Promise — son identité et son `await`
     * sont donc préservés (pas de `markRaw` nécessaire).
     */
    setPeerInitPromise(promise = null) {
        this.peerInitPromise = promise
    },

    resetReconnectAttempts() {
        this.peerReconnectAttempts = 0
    },
    /** @returns {number} numéro de la tentative qui vient d'être engagée */
    incrementReconnectAttempts() {
        this.peerReconnectAttempts += 1
        return this.peerReconnectAttempts
    },

    // ⚠️ `toRaw` sur les handles de timer : un id de timer est un nombre côté navigateur
    // mais un objet côté Node/vitest, donc enveloppé dans un proxy réactif en s'inscrivant
    // dans le state. Le forwarding du proxy suffit en pratique à `clearTimeout`, mais on ne
    // veut pas qu'une annulation de timer en dépende.

    /** @returns {boolean} true si un timer était bien armé (l'appelant loggue l'annulation) */
    clearPeerDestroyTimer() {
        if (!this.peerDestroyTimer) {
            return false
        }
        clearTimeout(toRaw(this.peerDestroyTimer))
        this.peerDestroyTimer = null
        return true
    },
    /** @returns {boolean} true si un backoff de reconnexion était bien armé */
    clearReconnectTimer() {
        if (!this.peerReconnectTimer) {
            return false
        }
        clearTimeout(toRaw(this.peerReconnectTimer))
        this.peerReconnectTimer = null
        return true
    },

    /**
     * Enregistre la closure qui débranche les listeners du Peer courant.
     *
     * Une **fonction** traverse le state réactif sans `markRaw` : `isObject` de
     * `@vue/shared` exige `typeof === 'object'`, donc Vue ne la proxifie ni au set ni au
     * get et son identité est préservée — même arbitrage que `setPeerInitPromise`, à
     * l'opposé du handle de timer ci-dessus qui est, lui, un objet côté Node/vitest.
     *
     * ⚠️ Remplacer une closure **exécute** celle en place. Sans ça, une init repartant
     * derrière un Peer orphelin (un `destroy()` qui a jeté laisse `destroyed === false`)
     * écraserait le seul moyen de débrancher ses listeners : ils resteraient branchés pour
     * la vie de l'onglet, à écrire dans un store qui décrit désormais un AUTRE peer.
     */
    setPeerListenersDetach(detach = null) {
        this.detachPeerListeners()
        this.peerListenersDetach = detach
    },

    /**
     * Exécute puis oublie la closure de détachement. Idempotent : double destruction, ou
     * reset survenant après un détachement déjà explicite.
     *
     * Le champ est vidé AVANT l'appel (une closure qui jette ne doit pas pouvoir être
     * rejouée) et l'exception est absorbée comme celle de `peer.destroy()` : un `off()` qui
     * jette ne doit empêcher ni la destruction du peer, ni la suite de `resetPeerState`.
     *
     * @returns {boolean} true si des listeners étaient bien branchés
     */
    detachPeerListeners() {
        const detach = this.peerListenersDetach
        this.peerListenersDetach = null

        if (typeof detach !== 'function') {
            return false
        }

        try {
            detach()
        } catch (e) {
            console.warn('[WebRTC2] Erreur lors du détachement des listeners du Peer :', e)
        }
        return true
    },

    /**
     * Remet à zéro tout l'état du peer singleton (appelé à sa destruction).
     *
     * ⚠️ `keepConsumerCount` : quand la destruction survient alors que `localPeer` est
     * déjà absent (échec d'initialisation), les consommateurs encore montés doivent
     * pouvoir décrémenter normalement jusqu'à 0 pour qu'un retry reparte d'un compte
     * juste. Remettre le compteur à 0 dans ce cas fausserait le comptage : un nouveau
     * consommateur enregistré avant le démontage des anciens verrait leurs décréments
     * passer sous zéro et déclencherait la destruction d'un peer valide.
     *
     * @param {Object}  [options]
     * @param {boolean} [options.keepConsumerCount=false]
     */
    resetPeerState({ keepConsumerCount = false } = {}) {
        // En tête, et exécutée plutôt que nullée : la closure référence le Peer qu'elle a
        // bindé. La nuller ici laisserait des listeners branchés sur une instance rendue
        // inatteignable à la ligne suivante — plus aucune référence pour les `off`.
        // Normalement déjà consommée par `_destroyPeerSingleton` ; c'est le filet du chemin
        // early-return (peer déjà absent après un échec d'init), où rien ne l'exécutait.
        this.detachPeerListeners()

        this.localPeer = null
        this.localPeerReady = false
        this.lastLocalPeerId = null
        this.peerInitPromise = null
        this.peerReconnectAttempts = 0
        this.clearPeerDestroyTimer()
        this.clearReconnectTimer()

        if (!keepConsumerCount) {
            this.peerConsumerCount = 0
        }
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

    /*--------------------------
    | Composition des rooms (index de présence)
    |
    | Projection, par contexte, de `ctx.connection.usersInRoom`. Son unique raison d'être
    | est de donner un prédicat FIABLE à removeRemotePeerId ci-dessous : « ce pair est-il
    | encore présent dans une room de cet onglet ? ». La map `connections` servait
    | auparavant de proxy pour cette question et y répondait mal — elle décrit des
    | connexions PeerJS, dont l'existence dépend de l'ordre des purges et pas de la
    | présence réelle.
    --------------------------*/

    /** Déclare la composition d'une room pour un contexte. @param {string} contextId */
    setRoomMembers(contextId, slugs = []) {
        if (!contextId) return
        this.roomMembers[contextId] = Array.isArray(slugs) ? [...slugs] : []
    },
    /** Le contexte est détruit : il ne témoigne plus de la présence de personne. */
    clearRoomMembers(contextId) {
        if (!contextId) return
        delete this.roomMembers[contextId]
    },

    /**
     * Oublie le peerId d'un pair qui a quitté la room.
     *
     * **Conditionnel**, et c'est le point : plusieurs contextes partagent ce store (le
     * `data-app` de System/Notifications.vue est monté en permanence, plus un contexte
     * par MediaBroadcastProvider). Un pair encore présent ailleurs a toujours besoin de
     * son peerId, donc on ne l'oublie qu'une fois absent de TOUTES les rooms connues.
     *
     * ⚠️ Le prédicat porte sur `roomMembers` (présence déclarée par la signalisation de
     * présence), **jamais** sur `connections` : cette map décrit des connexions PeerJS,
     * pas une présence. Avec elle, le verbe était un no-op permanent dès qu'une seconde
     * room existait — chaque contexte appelant `removeRemotePeerId` AVANT de purger sa
     * propre entrée de `connections`, même le dernier trouvait le pair « encore
     * connecté ». Le peerId d'un onglet fermé survivait donc à jamais : au retour du
     * pair, on rappelait un peer mort (`Could not connect to peer <uuid>`) sans jamais
     * redemander le frais, puisqu'on croyait déjà en avoir un.
     *
     * @param {string} userSlug
     */
    removeRemotePeerId(userSlug) {
        if (this.isUserInAnyRoom(userSlug)) return
        this.remotePeersId.delete(userSlug)
    },
    // Enregistrer l’id d’un peer distant lorsqu’il est reçu
    addRemotePeerId(userSlug, peerId) {
        this.remotePeersId.set(userSlug, peerId)
    },

    /**
     * Invalide un peerId distant devenu injoignable (PeerJS `peer-unavailable`).
     *
     * ⚠️ À NE PAS confondre avec removeRemotePeerId, qui exprime « ce pair a quitté la
     * room » et reste donc soumis au prédicat de présence. Ici l'information est
     * différente et certaine : ce peerId n'existe plus côté serveur de signalisation.
     * On supprime donc sans condition, et on purge TOUTES les demandes en vol pour ce
     * pair — quel que soit le contexte qui les a émises, puisqu'elles portent toutes sur
     * la même identité morte. Sans cette purge, la re-demande déclenchée juste après
     * serait étranglée par le garde d'âge SIGNALING_STALE_MS de
     * requestRemotePeerConnection.
     *
     * @param {string} userSlug
     */
    invalidateRemotePeerId(userSlug) {
        this.remotePeersId.delete(userSlug)
        this.clearWaitingRemotePeerIds(userSlug)
    },

    /*--------------------------
    | Demandes de peerId en vol — clé (slug, room, type), cf. keys.js
    --------------------------*/

    /**
     * Enregistre une demande émise. `data` doit porter `room` et `type` : ils forment la
     * clé, une demande sans eux ne serait retrouvable par aucun lecteur. `data.contextId`
     * enregistre le PROPRIÉTAIRE — c'est lui qui permet de tout purger au démontage sans
     * avoir à recomposer l'appartenance à partir de (room, type), qui ne la donne pas
     * exactement (une demande 'screen' appartient au contexte de son type principal).
     */
    addWaitingRemotePeerId(userSlug, data = {}) {
        const key = waitingPeerIdKey(userSlug, data?.room, data?.type)
        this.waitingRemotePeerId.set(key, {
            ...data,
            userSlug,
            createdAt: Date.now(),
        })
    },
    /** Retire UNE demande précise — celle du contexte qui vient d'obtenir sa cible. */
    removeWaitingRemotePeerId(userSlug, room = null, type = null) {
        this.waitingRemotePeerId.delete(waitingPeerIdKey(userSlug, room, type))
    },
    /**
     * Retire les demandes concernant un pair : toutes, ou seulement celles d'une room
     * donnée (`room` non nulle) quand c'est un seul contexte qui se ferme.
     */
    clearWaitingRemotePeerIds(userSlug, room = null) {
        for (const [key, entry] of [...this.waitingRemotePeerId.entries()]) {
            if (entry?.userSlug !== userSlug) continue
            if (room !== null && entry?.room !== room) continue
            this.waitingRemotePeerId.delete(key)
        }
    },
    /**
     * Un contexte se démonte : ses demandes en vol n'ont plus de destinataire.
     *
     * ⚠️ Indispensable et distinct des purges ci-dessus : le teardown passe par
     * `closePeerConnection`, qui sort par un early-return quand le contexte n'a AUCUNE
     * connexion dans sa room — cas parfaitement normal d'un provider démonté avant que
     * la signalisation ait abouti. Les demandes orphelines survivaient alors dans le
     * store partagé, et le contexte remonté à leur place les lisait comme les siennes :
     * il restait muet jusqu'à leur péremption (SIGNALING_STALE_MS). Un simple
     * mount/unmount — navigation SPA, HMR — suffisait à le déclencher.
     *
     * @param {string} contextId
     */
    clearWaitingRemotePeerIdsForContext(contextId) {
        if (!contextId) return
        for (const [key, entry] of [...this.waitingRemotePeerId.entries()]) {
            if (entry?.contextId === contextId) this.waitingRemotePeerId.delete(key)
        }
    },

    // gestion des players actifs (pour les appels en cours)
    addPlayer(player) {
        this.players.push(player)
    },
    removePlayer(player) {
        this.players = this.players.filter(p => p.videoId !== player)
    },

}