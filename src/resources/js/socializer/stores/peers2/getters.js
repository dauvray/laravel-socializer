import { waitingPeerIdKey } from '~socializer/stores/peers2/keys.js'
// La politique du bail vit avec les autres réglages du module, où elle porte son
// dimensionnement. L'alternative — passer la durée en argument depuis les deux sites
// d'appel — dupliquerait la POLITIQUE sur deux lecteurs : la classe de divergence
// silencieuse contre laquelle keys.js a été extrait.
import { REMOTE_PEER_ID_LEASE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

export default {

    /*--------------------------
    | Connections
    --------------------------*/
    getConnections() {
        return this.connections
    },

    /*--------------------------
    | Contextes montés
    --------------------------*/
    // ⚠️ Ces deux getters rendent une FONCTION, et ce n'est pas un tic de style : ils lisent
    // `contextRegistry`, qui est `markRaw` (cf. state.js). Un getter Pinia est un `computed`
    // — il ne s'invalide que sur une dépendance réactive. Sur une collection non réactive,
    // il évaluerait UNE fois et servirait ce cache pour la vie du store : le registre
    // paraîtrait figé à son premier état. Le même idiome est déjà utilisé plus bas par
    // `getWaitingRemotePeerId` et `isUserInAnyRoom`.

    /** Le contexte inscrit sous cet id, ou null. Clé de routage des entrants. */
    getContextById: (state) => (contextId) => {
        if (!contextId) return null
        return state.contextRegistry.get(contextId) ?? null
    },

    /**
     * Tous les contextes montés, en tableau.
     *
     * Un instantané, et c'est voulu : la recovery `peer-unavailable` mute le store en
     * itérant (invalidation d'un peerId, purge de connexions). Itérer directement la Map
     * exposerait ces mutations à l'itérateur.
     */
    getRegisteredContexts: (state) => () => {
        return [...state.contextRegistry.values()]
    },

    /*--------------------------
    | Identité du Peer local — le fait dérivé
    --------------------------*/
    // ⚠️ Fonction, pas `computed`, pour la MÊME raison que les deux getters ci-dessus, mais par
    // un autre chemin : `localPeer` porte un `Peer` `markRaw` (cf. usePeerTransport), donc ses
    // mutations internes (`_open`, `_disconnected`, `_destroyed`) sont invisibles à Vue. Un
    // `computed` ne s'invaliderait que sur `localPeerReady` : il servirait un état PARTIELLEMENT
    // périmé, ce qui est pire qu'un état absent pour un outil d'observation.

    /**
     * L'état du Peer local et son identité, en UN seul fait lisible.
     *
     * Six prédicats coexistent aujourd'hui pour répondre à « ai-je un peer utilisable, et quel
     * est son id ? » — `localPeer`, `localPeerReady`, `lastLocalPeerId`, `peerInitPromise`,
     * `localPeer.disconnected`, `localPeer.destroyed` — et ils divergent. Ce getter ne les
     * remplace pas encore (aucun lecteur n'est migré) : il les RÉCONCILIE en un seul endroit,
     * pour qu'on puisse enfin mesurer avant de reconcevoir.
     *
     * `id` est l'identité COURANTE, `lastId` l'identité HISTORIQUE, et leur divergence est le
     * cœur du problème : `Peer.disconnect()` met `_id` à `null` (peerjs 1.5.4,
     * `dist/bundler.mjs:1809`) alors que `lastLocalPeerId` reste posé. `waitForMeReady` lit le
     * second et répond « prêt » quand le premier ne vaut plus rien.
     *
     * @returns {{state: string, id: ?string, lastId: ?string, consumers: number}}
     */
    peerIdentity: (state) => () => {
        const peer = state.localPeer
        const id = (typeof peer?.id === 'string') ? peer.id : null
        const base = { id, lastId: state.lastLocalPeerId, consumers: state.peerConsumers.size }

        if (!peer) {
            // `creating` couvre l'aller-retour ICE de `_doInit` : une fenêtre de plusieurs
            // centaines de ms pendant laquelle il n'y a PAS de peer et pourtant rien à recréer.
            return { state: state.peerInitPromise ? 'creating' : 'absent', ...base }
        }
        if (peer.destroyed) return { state: 'destroyed', ...base }
        if (peer.disconnected) return { state: 'disconnected', ...base }
        return { state: state.localPeerReady ? 'ready' : 'connecting', ...base }
    },

    /**
     * Les contradictions présentes dans l'état du Peer. Tableau vide = état cohérent.
     *
     * Chaque entrée a été observée, ou est directement produite par un chemin du code : ce
     * n'est pas une liste défensive. La détection est ici (pure, testable) et le hurlement est
     * dans l'action `auditPeerState`.
     *
     * @returns {Array<{code: string, message: string}>}
     */
    peerStateViolations: (state) => () => {
        const peer = state.localPeer
        const violations = []
        const add = (code, message) => violations.push({ code, message })

        if (state.localPeerReady && !peer) {
            add('pret-sans-peer', 'localPeerReady est vrai alors que localPeer est nul')
        }

        if (state.lastLocalPeerId && !peer && !state.peerInitPromise) {
            // Produit par le `.catch` d'init : il nulle `localPeer` et laisse
            // `lastLocalPeerId` posé, à dessein (`waitForMeReady` en dépend). C'est donc un
            // état ATTENDU du code actuel — et c'est précisément pour ça qu'il doit être
            // nommé : « prêt » y est vrai pour `waitForMeReady` et faux pour tout le reste.
            add('id-historique-sans-peer', 'lastLocalPeerId est posé alors qu\'aucun peer n\'existe et qu\'aucune init n\'est en vol')
        }

        if (peer && state.localPeerReady && typeof peer.id !== 'string') {
            add('pret-sans-id', 'localPeerReady est vrai alors que le peer n\'a pas d\'id utilisable')
        }

        if (state.lastLocalPeerId && peer && (peer.destroyed || (peer.disconnected && !state.peerReconnectTimer))) {
            // ⭐ La contradiction la plus coûteuse du lot, et la seule qui soit SILENCIEUSE de
            // bout en bout. `waitForMeReady` ne consulte que `lastLocalPeerId` — un fait
            // HISTORIQUE — et répond donc « prêt » sur un peer fini. Tout ce qui en découle
            // publie ou attend un peerId que le serveur PeerJS ne connaît plus : en face,
            // « Could not connect to peer <uuid> », et l'arrivant ne voit rien.
            //
            // Le prédicat exclut expressément le cas transitoire : un backoff en vol
            // (`peerReconnectTimer`) veut dire qu'une reconnexion est attendue, et l'id
            // historique est alors exactement ce dont `reconnect()` repart. C'est l'ABSENCE
            // de recours — peer détruit, ou déconnecté sans rien d'armé (plafond de
            // tentatives atteint) — qui rend cet état terminal.
            add('id-historique-sur-peer-inutilisable', 'lastLocalPeerId est posé sur un peer détruit ou déconnecté sans reconnexion en vol')
        }

        if (peer?.destroyed && state.localPeerReady) {
            add('pret-mais-detruit', 'localPeerReady est vrai sur un peer détruit')
        }

        if (peer && !peer.destroyed && state.peerConsumers.size === 0 && !state.peerDestroyTimer) {
            // La famille du « peerId fantôme » : un Peer que plus personne ne consomme et
            // qu'aucun timer ne viendra détruire est hors d'atteinte de toute destruction
            // future. Sa socket vit jusqu'à `alive_timeout` (60 s) côté serveur PeerJS, et un
            // pair qui détient son id y envoie des offres dans le vide, sans erreur.
            add('peer-orphelin', 'un peer vivant n\'a plus aucun consommateur et aucune destruction n\'est armée')
        }

        return violations
    },

    /*--------------------------
    | LocalPerr
    --------------------------*/
    getLocalPeer() {
        return this.localPeer
    },
    getLocalPeerId() {
        return this.localPeer ? this.localPeer.id : null
    },
    getLastLocalPeerId() {
        return this.lastLocalPeerId
    },
    getLocalPeerReady() {
        return this.localPeerReady
    },

    /*--------------------------
    | Signal queues
    --------------------------*/
    getQueueForRoom: (state) => {
        return (roomId) => {
            return state.signalQueues[roomId] || null
        }
    },
    getLastSignal() {
        return this.lastSignal
    },
    getLastRoomSignal: (state) => {
        return (roomId) => {
            const q = state.signalQueues[roomId] || null
             return q?.at(-1) ?? null
        }
    },

    /*--------------------------
    | Composition des rooms (index de présence)
    --------------------------*/
    /**
     * Ce pair est-il présent dans au moins une room connue de cet onglet ?
     * Seul prédicat qui autorise à oublier son peerId (cf. removeRemotePeerId).
     */
    isUserInAnyRoom: (state) => (userSlug) => {
        if (!userSlug) return false
        return Object.values(state.roomMembers).some(
            (slugs) => Array.isArray(slugs) && slugs.includes(userSlug)
        )
    },

    /*--------------------------
    | Remote peers ID
    --------------------------*/
    // ⚠️ Lectures EXACTES : une demande appartient à un contexte (slug + room + type).
    // Interroger sur le slug seul ferait lire à un contexte la demande d'un autre —
    // c'est exactement ce qui empêchait le contexte `stream` d'émettre la sienne.
    getWaitingRemotePeerId: (state) => (userSlug, room = null, type = null) => {
        return state.waitingRemotePeerId.get(waitingPeerIdKey(userSlug, room, type)) ?? null
    },
    hasWaitingRemotePeerId: (state) => (userSlug, room = null, type = null) => {
        return state.waitingRemotePeerId.has(waitingPeerIdKey(userSlug, room, type))
    },
    /** Toutes les demandes en vol concernant un pair, tous contextes confondus (debug/tests). */
    getWaitingRemotePeerIds: (state) => (userSlug) => {
        return [...state.waitingRemotePeerId.values()].filter((entry) => entry?.userSlug === userSlug)
    },
    hasRemotePeerId: (state) => (userSlug) => {
        return state.remotePeersId.has(userSlug)
    },
    /**
     * Le peerId connu de ce pair — **aveugle au bail**, et ça n'est pas négociable.
     *
     * C'est ce que lisent les gardes d'admission : le chemin (b) de
     * `_isAuthorizedIncomingPeer` (allowlist de l'appel direct, `getRemotePeerId(from)
     * === conn.peer`) et l'anti-usurpation par résolution inverse. Y brancher une
     * péremption transformerait une expiration en REFUS — refermant la visio 1-à-1 hors
     * room, que `securite.md` désigne comme la non-régression à ne jamais casser.
     *
     * Rend `undefined` quand l'entrée manque, comme le `Map.get` qu'il remplace.
     */
    getRemotePeerId: (state) => (userSlug) => {
        return state.remotePeersId.get(userSlug)?.peerId
    },
    /**
     * Le peerId de ce pair **si le bail court encore** — sinon rien.
     *
     * Seuls lecteurs autorisés : les deux points de décision d'appel de
     * `useConnectionPool` (`requestOrConnectPeer` et `_handleConnectionAttempt`). Aucun
     * garde d'admission ne doit lire ceci (cf. `getRemotePeerId` ci-dessus).
     *
     * ⚠️ **Ne supprime rien.** « Je ne compose plus » n'est pas « je ne reconnais plus » :
     * l'entrée reste l'allowlist du chemin (b). L'appelant redemande la signalisation, et
     * la réponse ré-estampille l'entrée.
     *
     * ⚠️ **Fonction, pas `computed`** — même raison que les getters du haut de ce fichier,
     * par un troisième chemin : un `computed` mettrait en cache le VERDICT de fraîcheur,
     * qui dépend de l'horloge et d'aucune dépendance réactive. Il ne se réévaluerait
     * jamais.
     *
     * **Fail-closed** : une entrée sans estampille numérique n'est pas composable. C'est
     * ce qu'écrirait un double de test qui aurait oublié le tampon, et composer sur la foi
     * d'une entrée dont on ignore l'âge est exactement ce que ce getter interdit.
     */
    getDialableRemotePeerId: (state) => (userSlug) => {
        const entry = state.remotePeersId.get(userSlug)
        if (!entry?.peerId || typeof entry.learnedAt !== 'number') return undefined

        return (Date.now() - entry.learnedAt) < REMOTE_PEER_ID_LEASE_MS
            ? entry.peerId
            : undefined
    },
    /**
     * La résolution inverse peerId → slug — **aveugle au bail**, et c'est un point de
     * sécurité, pas d'ergonomie.
     *
     * Deux lecteurs en dépendent, et tous deux casseraient en silence :
     * - la recovery `peer-unavailable` de `usePeerTransport`, qui ne retrouverait plus le
     *   slug à invalider et sortirait sur `if (!targetSlug) return` — le bail détruirait
     *   le filet qu'il est censé soulager ;
     * - l'anti-usurpation de `_isAuthorizedIncomingPeer` (`resolvedSlug !== declaredFrom`),
     *   qui cesserait de mordre dès l'expiration. Une péremption temporelle sur une lecture
     *   anti-usurpation est un contournement planifiable par l'attaquant.
     *
     * Rend le PREMIER slug qui matche : l'ordre d'insertion de la `Map`, à l'identique des
     * deux boucles écrites à la main qu'elle remplace. Un peerId mappé sur deux slugs est
     * la signature d'une usurpation, que l'admission refuse sur la contradiction.
     */
    getSlugByRemotePeerId: (state) => (peerId) => {
        if (!peerId) return null
        const wanted = String(peerId)

        for (const [slug, entry] of state.remotePeersId.entries()) {
            if (entry?.peerId && String(entry.peerId) === wanted) return slug
        }

        return null
    },

    /*--------------------------
    | Players
    --------------------------*/
    getPlayers() {
        return this.players
    },

}