import { toRaw } from 'vue'
import { isEmpty } from '~estarter/services/helpers.js'
import { waitingPeerIdKey } from '~socializer/stores/peers2/keys.js'
// Même raison que keys.js : le diff de composition est un contrat partagé avec le double de
// test, contre lequel les arrivées et les départs sont assertés.
import { diffRoomMembers } from '~socializer/stores/peers2/roomDiff.js'
// Même raison encore : la phase du Peer et sa table de transitions sont un contrat partagé
// entre ces actions (écriture), les getters (lecture) et le double de test.
import { PEER_PHASES, isExpectedPeerPhaseTransition } from '~socializer/stores/peers2/phases.js'

export default {

    /*--------------------------
    | Cycle de vie du Peer — les transitions
    |
    | UNIQUES écrivains de `peerPhase`, et appelés par le seul `usePeerTransport` : la
    | phase suit les événements de PeerJS, elle ne s'invente nulle part ailleurs.
    |
    | Ils remplacent trois setters qui n'avaient AUCUN appelant (`setLocalPeer`,
    | `setLocalPeerReady`, `setLastLocalPeerId`) : le transport écrivait les champs en
    | direct, depuis quatre endroits, dans un ordre que rien ne contrôlait.
    --------------------------*/

    /**
     * Applique une transition de phase. **Toujours**, même inattendue — cf. l'en-tête de
     * `phases.js` : une phase qui refuserait de suivre décrirait un peer qui n'existe
     * plus, ce qui est exactement la divergence qu'elle supprime. L'inattendu est
     * journalisé, pas empêché.
     *
     * @param {string} to    Une des `PEER_PHASES`
     * @param {string} where La transition d'où l'on vient — même rôle que dans `auditPeerState`
     * @returns {string} la phase désormais en vigueur
     */
    setPeerPhase(to, where = '?') {
        const from = this.peerPhase

        if (!isExpectedPeerPhaseTransition(from, to)) {
            console.warn(
                `[WebRTC2][peerFSM] Transition inattendue : ${from} → ${to} (${where}) — appliquée quand même`
            )
        }

        this.peerPhase = to
        return to
    },

    /** Une init démarre : il n'y a pas encore de `Peer`, et c'est normal. */
    markPeerCreating() {
        return this.setPeerPhase(PEER_PHASES.CREATING, 'début d\'init')
    },

    /** L'instance existe, son `'open'` n'est pas arrivé. */
    markPeerConnecting() {
        return this.setPeerPhase(PEER_PHASES.CONNECTING, 'Peer construit')
    },

    /**
     * `'open'` reçu : le pair est joignable sous cet id.
     *
     * Publie l'identité et remet le compteur de reconnexion à zéro — les trois faits d'un
     * `'open'`, dans la seule action qui sait ce que cet événement signifie. Un `id` non
     * exploitable (le cas `reconnect()`, qui rend `null`) laisse `lastLocalPeerId` en
     * place : c'est de lui que le transport repart pour restaurer l'instance.
     *
     * @param {?string} id L'identité attribuée par le serveur PeerJS
     */
    markPeerOpen(id = null) {
        if (typeof id === 'string' && id.length > 0) {
            this.lastLocalPeerId = id
        }

        // Par le verbe, pas par l'affectation : il reste le pendant d'
        // `incrementReconnectAttempts`, et un compteur à deux écrivains dont l'un est anonyme
        // est exactement ce que cette passe supprime ailleurs.
        this.resetReconnectAttempts()

        return this.setPeerPhase(PEER_PHASES.READY, 'après \'open\' du Peer')
    },

    /** Socket tombé. L'identité historique reste : `reconnect()` en repart. */
    markPeerDisconnected() {
        return this.setPeerPhase(PEER_PHASES.DISCONNECTED, 'après \'disconnected\' du Peer')
    },

    /**
     * Plus de Peer — init échouée, ou instance abandonnée.
     *
     * ⚠️ Ne touche NI `lastLocalPeerId` NI `localPeer` : celui-ci n'est que la phase, et
     * `resetPeerState` est le geste complet. Son unique appelant — le `.catch` d'init —
     * nulle les deux champs juste avant : il ne laisse plus d'identité derrière lui, et
     * c'est bien à l'appelant de le faire, lui seul sachant pourquoi le peer s'en va.
     *
     * @param {string} where
     */
    markPeerAbsent(where = 'Peer abandonné') {
        return this.setPeerPhase(PEER_PHASES.ABSENT, where)
    },

    /*--------------------------
    | Registre des contextes montés
    |
    | Même durée de vie que `localPeer`, parce que ce sont ses dispatchers qui le
    | consultent — cf. le commentaire de `contextRegistry` dans state.js.
    --------------------------*/

    /**
     * Inscrit un contexte. **Last-write-wins volontaire** : un contexte remonté reprend
     * l'id de celui qui se démonte, et c'est le nouveau qui doit recevoir les connexions.
     */
    registerContext(ctx) {
        if (!ctx?.contextId) return
        this.contextRegistry.set(ctx.contextId, ctx)
    },

    /**
     * Retire un contexte — **seulement si l'entrée lui appartient encore**.
     *
     * Sans ce garde d'identité, l'`onUnmounted` d'un contexte en cours de démontage
     * effacerait l'entrée désormais détenue par son remplaçant (cf. le last-write-wins
     * ci-dessus), et ce remplaçant ne recevrait plus aucune connexion entrante.
     */
    unregisterContext(ctx) {
        if (!ctx?.contextId) return
        if (this.contextRegistry.get(ctx.contextId) === ctx) {
            this.contextRegistry.delete(ctx.contextId)
        }
    },

    /*--------------------------
    | Observabilité de l'état du Peer
    --------------------------*/

    /**
     * Journalise les contradictions de l'état du Peer, s'il y en a.
     *
     * Le churn de peers du 24/08 a été DEVINÉ par arithmétique sur des logs Docker, faute d'un
     * seul endroit disant « voilà l'état du Peer, et voilà en quoi il se contredit ». Cette
     * action est cet endroit. Elle n'épingle rien et ne corrige rien : elle rend nommable ce
     * qui ne l'était pas.
     *
     * Le calcul est dans `peerStateViolations` (pur, testable sans console) ; ici il n'y a
     * que le hurlement. `console.error` à dessein : une contradiction d'invariant n'est pas
     * une information, et c'est le seul canal que le module réserve à l'anormal.
     *
     * ⚠️ **Aucun garde `import.meta.env.DEV`, et c'est délibéré.** Vite ne lit pas cette
     * expression, il la REMPLACE par sa valeur au build : un `if (!import.meta.env.DEV) return`
     * devient `if (true) return`, et le minifieur supprime tout ce qui suit — message compris.
     * Vérifié sur `public/build` : la chaîne `[WebRTC2][invariant]` en disparaissait
     * entièrement. L'instrument s'éteignait donc dans le SEUL environnement où le bug se
     * reproduit, ce qui est le piège même du hook HMR « inerte en production » qui était en
     * réalité actif. Le coût est nul de toute façon : l'audit est appelé sur les transitions du
     * cycle de vie du Peer (init, `open`, abandon de reconnexion, destruction), pas dans un
     * chemin chaud, et ne journalise que s'il a quelque chose à dire.
     *
     * @param {string} where D'où l'audit est appelé — sans ça, un état contradictoire ne dit
     *                       pas quelle transition l'a produit, et c'est toute l'information.
     * @returns {Array<{code: string, message: string}>} Les violations, pour les tests.
     */
    auditPeerState(where = '?') {
        const violations = this.peerStateViolations()
        if (violations.length === 0) return violations

        console.error(
            `[WebRTC2][invariant] ${where} — ${violations.length} contradiction(s) dans l'état du Peer :`,
            { identity: this.peerIdentity(), violations }
        )
        return violations
    },

    /*--------------------------
    | Runtime du Peer singleton
    |
    | Ref-counting, garde d'init et reconnexion du `localPeer`. Ces verbes sont appelés
    | exclusivement par usePeerTransport ; ils vivent ici pour que l'état suive celui du
    | peer (cf. commentaire de state.js).
    --------------------------*/

    /**
     * Un consommateur de plus pour le peer singleton. Idempotent par jeton.
     *
     * @param {*} token Jeton propre à une instance de usePeerTransport
     * @returns {number} nombre de consommateurs après l'ajout
     */
    addPeerConsumer(token) {
        if (token === undefined || token === null) return this.peerConsumers.size
        this.peerConsumers.add(token)
        return this.peerConsumers.size
    },

    /**
     * Un consommateur se démonte.
     *
     * @param {*} token Le jeton reçu à l'inscription
     * @returns {number|null} nombre de consommateurs restants, ou **`null`** si ce jeton
     *   n'était pas inscrit — « je n'avais rien à retirer, il n'y a rien à conclure ».
     *
     * ⚠️ La distinction `0` / `null` est tout l'intérêt du jeton, et l'appelant DOIT
     * tester `=== 0`. Avec l'ancien compteur planché, un retrait orphelin rendait `0` :
     * indistinguable de « le dernier consommateur vient de partir », donc il ordonnait
     * une destruction. C'est ce qui permettait à un Peer encore utilisé d'être détruit
     * après un `resetPeerState` (qui remettait le compteur à zéro sous des composants
     * toujours montés).
     */
    removePeerConsumer(token) {
        if (!this.peerConsumers.delete(token)) return null
        return this.peerConsumers.size
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
    /** @returns {boolean} true si un rafraîchissement de configuration ICE était bien armé */
    clearIceRefreshTimer() {
        if (!this.peerIceRefreshTimer) {
            return false
        }
        clearTimeout(toRaw(this.peerIceRefreshTimer))
        this.peerIceRefreshTimer = null
        return true
    },

    resetIceRefreshAttempts() {
        this.peerIceRefreshAttempts = 0
    },
    /** @returns {number} numéro de la tentative infructueuse qui vient d'être comptée */
    incrementIceRefreshAttempts() {
        this.peerIceRefreshAttempts += 1
        return this.peerIceRefreshAttempts
    },

    /** @returns {boolean} true si un rafraîchissement d'attestation était bien armé */
    clearAttestationRefreshTimer() {
        if (!this.peerAttestationRefreshTimer) {
            return false
        }
        clearTimeout(toRaw(this.peerAttestationRefreshTimer))
        this.peerAttestationRefreshTimer = null
        return true
    },

    resetAttestationAttempts() {
        this.peerAttestationAttempts = 0
    },
    /** @returns {number} numéro de la tentative infructueuse qui vient d'être comptée */
    incrementAttestationAttempts() {
        this.peerAttestationAttempts += 1
        return this.peerAttestationAttempts
    },

    /**
     * Pose l'attestation servie par le serveur pour le peerId local, et sa politique.
     *
     * Les deux ensemble, jamais l'une sans l'autre : `enforce` n'a de sens qu'accompagné de ce
     * qu'il faut présenter pour ne pas être refusé. Le seul écrivain de production est
     * `usePeerTransport`, comme pour toutes les transitions du `Peer`.
     */
    setLocalPeerAttestation(attestation = null, enforce = false) {
        this.localPeerAttestation = typeof attestation === 'string' && attestation !== ''
            ? attestation
            : null
        this.attestationEnforce = enforce === true
    },

    /**
     * Mémorise le verdict rendu par le serveur pour un peerId distant.
     *
     * ⚠️ N'écrit RIEN dans `remotePeersId` — cf. l'avertissement porté par `attestedPeers` dans
     * `state.js`. Ce registre établit QUI est en face, jamais s'il a le droit d'entrer.
     *
     * ⚠️ Mémoïse aussi les refus (`slug: null`), et c'est nécessaire : sans cela, un pair refusé
     * qui insiste ferait payer un aller-retour à chacune de ses tentatives, à la cadence qu'il
     * choisit. Le verdict est daté par l'appelant, qui seul sait jusqu'à quand s'y fier.
     *
     * @param {string} peerId
     * @param {string|null} slug
     * @param {number} expiresAt  Horodatage (ms) au-delà duquel le verdict est redemandé
     */
    noteAttestedPeer(peerId, slug, expiresAt) {
        if (typeof peerId !== 'string' || peerId === '') {
            return
        }

        this.attestedPeers.set(String(peerId), {
            slug: typeof slug === 'string' && slug !== '' ? slug : null,
            expiresAt: typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? expiresAt : 0,
        })
    },

    /**
     * Compte une admission accordée sans que rien ne rattache le peerId au slug déclaré.
     *
     * ⚠️ **Un compteur, pas un journal, et c'est ce qui le rend utile.** La trace console existe
     * déjà (`Admission entrante non corroborée`) mais elle se perd dans un onglet ouvert depuis
     * des heures ; ce chiffre est ce qu'on relit pour décider d'activer `enforce`. Tant qu'il bouge
     * en usage nominal, le refus couperait des pairs légitimes.
     *
     * Jamais remis à zéro — ni par `resetPeerState`, ni au démontage d'un contexte : c'est une
     * mesure cumulée pour la vie de l'onglet, et une remise à zéro la rendrait dépendante du
     * nombre de navigations SPA.
     */
    noteUncorroboratedAdmission() {
        this.uncorroboratedAdmissions += 1
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
     * ⚠️ **Ne touche PAS `peerConsumers`**, et c'est le point clé : un consommateur est un
     * composant MONTÉ, pas une propriété du Peer. Détruire le Peer n'en démonte aucun, et
     * leur inscription doit survivre pour qu'ils puissent en reconstruire un.
     *
     * L'ancien paramètre `keepConsumerCount` compensait le fait que ce reset vidait le
     * compteur : il n'a plus d'objet, puisque le compteur n'est plus jamais vidé ici. Le
     * seul retrait légitime est celui du consommateur lui-même, par son jeton, dans son
     * `onUnmounted`.
     */
    resetPeerState() {
        // En tête, et exécutée plutôt que nullée : la closure référence le Peer qu'elle a
        // bindé. La nuller ici laisserait des listeners branchés sur une instance rendue
        // inatteignable à la ligne suivante — plus aucune référence pour les `off`.
        // Normalement déjà consommée par `_destroyPeerSingleton` ; c'est le filet du chemin
        // early-return (peer déjà absent après un échec d'init), où rien ne l'exécutait.
        this.detachPeerListeners()

        this.localPeer = null
        // Affectation directe, pas `markPeerAbsent` : un reset n'est pas une transition —
        // il ramène l'état à son point de départ depuis N'IMPORTE QUELLE phase, y compris
        // celles d'où « absent » ne s'atteint pas normalement. Le journal de transitions
        // n'a rien à en dire.
        this.peerPhase = PEER_PHASES.ABSENT
        this.lastLocalPeerId = null
        this.peerInitPromise = null
        this.peerReconnectAttempts = 0
        this.clearPeerDestroyTimer()
        this.clearReconnectTimer()
        // Le minuteur de rafraîchissement vise l'instance qu'on vient d'oublier. Ne pas l'annuler
        // ici laisserait, des heures durant, un minuteur qui se réveille pour un `Peer` disparu :
        // sa garde d'identité le ferait sortir sans dommage, mais une requête HTTP partirait pour
        // rien à chaque échéance, sur un onglet qui n'a peut-être plus aucun contexte WebRTC.
        this.clearIceRefreshTimer()
        this.peerIceRefreshAttempts = 0
        // Même raison, plus une qui lui est propre : l'attestation décrit un peerId PRÉCIS. La
        // laisser derrière un `Peer` remplacé, c'est la présenter pour une identité qui n'est plus
        // la nôtre — le vérificateur d'en face la refuserait, et ce refus-là serait indistinguable
        // d'une usurpation.
        this.clearAttestationRefreshTimer()
        this.peerAttestationAttempts = 0
        this.localPeerAttestation = null
        // ⚠️ `attestationEnforce` N'EST PAS remise à `false` : c'est la politique du SERVEUR, pas un
        // fait de mon `Peer`. La rabaisser à chaque destruction rouvrirait la fenêtre à chaque
        // remontage de contexte, alors que la valeur connue reste vraie jusqu'à la prochaine
        // réponse. ⚠️ `attestedPeers` n'est pas vidé non plus — les identités des pairs distants ne
        // dépendent pas de la vie du nôtre (même arbitrage que `contextRegistry`), et ce qui les
        // périme est leur propre `expiresAt`.
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
    | LA composition, par contexte — pas une projection : `ctx.connection.remotePeers` est un
    | accesseur en lecture seule au-dessus de `roomMembers[contextId]`. Elle sert deux
    | lecteurs de nature différente, et c'est ce qui gouverne toute décision ici :
    |
    |   - `isUserInAnyRoom` ci-dessous — un balayage de TOUS les contextes de l'onglet, seul
    |     prédicat qui autorise à oublier un peerId. La map `connections` servait auparavant
    |     de proxy pour cette question et y répondait mal : elle décrit des connexions PeerJS,
    |     dont l'existence dépend de l'ordre des purges et pas de la présence réelle ;
    |   - `getRoomMembers` — la lecture d'UN contexte, qui est l'allowlist du chemin (a) des
    |     deux gardes d'autorisation.
    |
    | ⚠️ Toutes les écritures ci-dessous RÉAFFECTENT le tableau, aucune ne le mute : les
    | lecteurs tracent la clé, et une mutation en place ne l'invalide pas (cf. state.js).
    --------------------------*/

    /**
     * Le diff d'un tour de présence ET son écriture, en un seul appel synchrone.
     *
     * ⚠️ Ce que ce verbe apporte est **un seul chemin d'écriture** vers l'allowlist, la
     * valeur précédente étant lue là où la nouvelle est écrite. Ce n'est PAS l'atomicité —
     * à ne pas re-dériver : le couple lecture-puis-écriture de `usePeerConnections` n'a
     * jamais eu de point de suspension entre ses deux moitiés (son unique `await` précède
     * la lecture), donc aucun TOCTOU n'y était possible et le mutex `_diffLock` qui
     * prétendait le garder n'a jamais rien gardé. Ce qu'il sérialisait, l'ordre des tours,
     * l'est déjà par la boucle de drain de `useConnectionPool.syncUsersConnections` — son
     * seul appelant.
     *
     * Rester SYNCHRONE est en revanche un invariant : le jour où ce verbe deviendrait
     * asynchrone, la fenêtre s'ouvrirait pour de bon. `peers2Store.roomMembers.test.js`
     * l'épingle en assertant l'état sans `await`.
     *
     * L'appelant garde ses barrières asynchrones AVANT l'appel — ce verbe ne décide pas
     * quand un tour a le droit d'écrire, seulement ce que ce tour change.
     *
     * ⚠️ Écrit à TOUS les tours, observation ou non : sur une liste vide, `removedSlugs`
     * vaut la composition précédente entière, et c'est le seul tour qui puisse rendre le
     * dernier partant purgeable.
     *
     * @param {string} contextId
     * @param {string[]} nextSlugs  Composition observée à ce tour (pairs DISTANTS)
     * @returns {{ newSlugs: string[], removedSlugs: string[] }}
     */
    computeRoomDiff(contextId, nextSlugs = []) {
        if (!contextId) return { newSlugs: [], removedSlugs: [] }

        const next = Array.isArray(nextSlugs) ? [...nextSlugs] : []
        const diff = diffRoomMembers(this.roomMembers[contextId], next)

        this.roomMembers[contextId] = next

        return diff
    },

    /**
     * Déclare la composition d'une room pour un contexte, sans rien calculer.
     *
     * Reste le verbe de SEMIS — un test qui doit poser une composition sans faire tourner
     * `getRoomUsersDiff`, et rien d'autre en production : l'écrivain de production est
     * `computeRoomDiff` ci-dessus.
     *
     * @param {string} contextId
     */
    setRoomMembers(contextId, slugs = []) {
        if (!contextId) return
        this.roomMembers[contextId] = Array.isArray(slugs) ? [...slugs] : []
    },
    /**
     * Le contexte est détruit : il ne témoigne plus de la présence de personne.
     *
     * ⚠️ `owner` — le jumeau du garde de `unregisterContext`, et pour la même raison : le
     * contextId est `type-room` et le registre est last-write-wins VOLONTAIRE, donc deux
     * contextes homonymes se chevauchent à chaque remontage. Sans lui, l'`onUnmounted` du
     * mourant efface la composition détenue par son remplaçant — qui garde `presenceSynced`
     * (monotone, seul son propre `destroy()` le rabaisse) et va donc droit au verdict avec
     * une allowlist vide : toute connexion entrante du chemin présence est REFUSÉE, sans
     * erreur console, et un refus n'est pas rattrapable.
     *
     * ⚠️ La sémantique n'est PAS celle de `unregisterContext`, et l'écart est délibéré :
     * on ne s'abstient que si l'entrée appartient à QUELQU'UN D'AUTRE. Un contexte jamais
     * inscrit au registre — `setLocalPeer` non appelé, cas d'un provider monté sans peer —
     * doit pouvoir purger la sienne, sinon son entrée fuit pour la vie de l'onglet et
     * épingle ses membres, ce que ce garde est précisément là pour empêcher.
     *
     * @param {string} contextId
     * @param {Object|null} [owner] Le contexte qui retire son témoignage. Omis : aucun
     *                              garde — c'est le verbe de semis des tests.
     */
    clearRoomMembers(contextId, owner = null) {
        if (!contextId) return

        const holder = this.contextRegistry.get(contextId)
        if (owner && holder && holder !== owner) return

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
    /**
     * Enregistrer l'id d'un peer distant lorsqu'il est reçu.
     *
     * Estampille l'entrée : c'est le **renouvellement du bail**
     * (`REMOTE_PEER_ID_LEASE_MS`), et il n'est pas conditionné à un changement de valeur.
     * Ré-apprendre le même peerId est une preuve fraîche que ce peerId est le bon — c'est
     * ce qui fait qu'une room saine ne paie jamais d'aller-retour de signalisation
     * supplémentaire, `connectToPeer` écrivant à chaque réponse reçue.
     *
     * @param {string} userSlug
     * @param {string} peerId
     */
    addRemotePeerId(userSlug, peerId) {
        this.remotePeersId.set(userSlug, { peerId, learnedAt: Date.now() })
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