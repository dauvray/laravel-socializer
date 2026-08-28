/**
 * createMockContext.js — Factory de contexte minimal pour les tests
 *
 * Reproduit l'interface complète retournée par createPeerContext()
 * sans aucune dépendance réelle (stores Pinia, AjaxService, PeerJS, DOM).
 *
 * Toutes les fonctions des stores sont des vi.fn() pour permettre
 * l'assertion et la simulation de comportements.
 *
 * Usage :
 *   const ctx = createMockContext()
 *   const ctx = createMockContext({
 *       meStore: { getMe: { slug: 'alice', name: 'Alice' } },
 *       session: { currentType: 'visio' },
 *   })
 *
 * @param {Object} overrides  Overrides partiels appliqués après la création
 * @returns {Object}          Contexte complet compatible avec les composables WebRTC2
 */
import { reactive, computed, ref, watch, markRaw } from 'vue'
import { vi } from 'vitest'
import { createCallStateMachine } from '~socializer/components/WebRTC2/Composables/utils/useCallStateMachine.js'
import { isValidSlug } from '~socializer/components/WebRTC2/Composables/utils/validators.js'
// ⚠️ Importée du store, jamais réécrite ici : la clé est un contrat partagé, une
// seconde implémentation dans le mock divergerait en silence.
import { waitingPeerIdKey } from '~socializer/stores/peers2/keys.js'
// Même raison encore : le diff de composition et la valeur d'une room non déclarée sont un
// contrat partagé. C'est contre CE double que les arrivées et les départs sont assertés — une
// seconde implémentation du diff rendrait ces assertions muettes sur la production.
import { diffRoomMembers, EMPTY_MEMBERS } from '~socializer/stores/peers2/roomDiff.js'
// Même raison : la phase du Peer et sa table de transitions sont le contrat que ce double
// doit reproduire — une seconde table recopiée ici divergerait sans jamais lever.
import { PEER_PHASES, isExpectedPeerPhaseTransition } from '~socializer/stores/peers2/phases.js'
// Même raison : le bail est une politique, elle a un seul domicile.
import { REMOTE_PEER_ID_LEASE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'
import { mockEventBus } from './mockEventBus.js'

export function createMockContext(overrides = {}) {
    const contextId = overrides.contextId ?? 'test-data-app'

    // ── Machine d'état d'appel ────────────────────────────────────────────────
    const callMachine = createCallStateMachine(contextId)

    // ── EventBus ─────────────────────────────────────────────────────────────
    const eventBus = overrides.eventBus ?? mockEventBus()

    // ── Session state ─────────────────────────────────────────────────────────
    const session = reactive({
        currentType: 'data',
        currentRoom: 'app',
        onAirRoom: 'app',
        currentCallRoomId: null,
        currentCallUsers: [],
        // Allowlist du garde sortant — registre dédié, jamais currentCallUsers
        // (cf. createPeerContext)
        authorizedCallPeers: new Map(),
        topology: 'mesh',
        hubSlug: null,
        isHub: null,
        ...(overrides.session ?? {}),
    })

    // ── Media state ───────────────────────────────────────────────────────────
    const media = reactive({
        videoContainer: '#videoContainer',
        currentStream: null,
        screenStream: null,
        remoteStreamsMap: new Map(),
        // Pairs dont un flux est annoncé mais pas encore reçu (cf. createPeerContext)
        announcedStreamsMap: new Map(),
        isStreaming: false,
        isCapturing: false,
        isAudioStream: false,
        ...(overrides.media ?? {}),
    })

    // ── UI state ──────────────────────────────────────────────────────────────
    const ui = reactive({
        streamStates: {
            isMuted: false,
            isVideoEnabled: true,
        },
        ...(overrides.ui ?? {}),
    })

    // ── Composition des rooms (peerStore.roomMembers) ─────────────────────────
    // Déclarée ICI, avant `connection`, parce que `connection.remotePeers` n'est qu'un
    // accesseur au-dessus d'elle — comme en production, où le champ n'existe plus que
    // sous la forme d'un getter vers `peerStore.roomMembers[contextId]`.
    //
    // ⚠️ `reactive`, comme l'état Pinia réel — et la raison exacte a été MESURÉE, parce
    // qu'elle n'est pas celle qu'on croit. Un semis par le setter ci-dessous déclenche même
    // sur un objet nu : c'est le proxy de `connection` qui trace la clé `remotePeers` et
    // déclenche sur l'écriture, l'index n'y est pour rien. Ce qu'un index nu casserait est
    // le chemin de PRODUCTION — écrire par `computeRoomDiff`, lire par l'accesseur —, que
    // plus aucun test ne pouvait voir depuis que la production a cessé d'écrire ici. Le
    // double aurait alors servi des valeurs justes à des lecteurs qui ne se réveillent
    // jamais. Épinglé par `roomMembersSourceOfTruth.test.js`, vu rouge avec un objet nu.
    const _roomMembers = reactive({})

    // ── Connection state ──────────────────────────────────────────────────────
    // `presenceSynced: true` par défaut — un contexte de test qui se voit attribuer un
    // `remotePeers` (fût-il vide) décrit une room qu'il CONNAÎT. Le laisser à false
    // ferait basculer chaque garde d'admission sur le chemin « je ne sais pas encore »
    // et rendrait les tests de refus dépendants d'un timeout. Les tests qui visent
    // précisément le démarrage d'un contexte le passent explicitement à false.
    //
    // ⚠️ `remotePeers` est extrait des overrides AVANT le spread, et sème `_roomMembers` au
    // lieu d'entrer dans l'objet. Spreadé, il écraserait l'accesseur par un tableau nu et
    // ressusciterait dans le double le miroir que la production vient de supprimer — sans
    // rien casser sur le coup : les deux gardes d'autorisation lisent
    // `Array.isArray(…) ? … : []`, donc la composition serait simplement devenue invisible
    // au store, et la moitié des tests d'autorisation attend déjà un refus.
    const { remotePeers: _seededRemotePeers, ...connectionOverrides } = overrides.connection ?? {}
    if (_seededRemotePeers !== undefined) {
        _roomMembers[contextId] = Array.isArray(_seededRemotePeers) ? [..._seededRemotePeers] : []
    }

    const connection = reactive({
        // Les pairs DISTANTS de la room, en slugs. Accesseur, pas champ : la composition
        // vit dans `peerStore.roomMembers[contextId]`, ici comme en production.
        //
        // Le setter, lui, N'EXISTE PAS en production — `createPeerContext` n'expose qu'un
        // getter et une écriture y lève. Il est conservé ici comme verbe de SEMIS, parce
        // que la moitié des fichiers de test stube `getRoomUsersDiff` : sans écrivain de
        // production, la composition n'a aucun autre moyen d'exister. Il écrit
        // `_roomMembers` en direct, jamais via le `vi.fn()` `setRoomMembers`, dont les
        // appels sont assertés ailleurs.
        get remotePeers() {
            return _roomMembers[contextId] ?? EMPTY_MEMBERS
        },
        set remotePeers(slugs) {
            _roomMembers[contextId] = Array.isArray(slugs) ? [...slugs] : []
        },
        presenceSynced: true,
        // Annuaire `user_id` → slug, `markRaw` comme dans createPeerContext : `reactive()`
        // convertirait la Map en collection réactive, et le double cesserait de se
        // comporter comme la production sur le seul point qui compte ici (une lecture
        // impérative, sans traçage).
        slugByUserId: markRaw(new Map()),
        ...connectionOverrides,
    })

    // Garde structurel du paragraphe ci-dessus : si un jour un override reprend le chemin
    // du spread, il aura remplacé l'accesseur par une valeur, et ce test le dira tout de
    // suite au lieu de laisser un fichier entier verdir pour la mauvaise raison.
    if (typeof Object.getOwnPropertyDescriptor(connection, 'remotePeers')?.get !== 'function') {
        throw new Error(
            'createMockContext: `connection.remotePeers` a perdu son accesseur — la composition '
            + 'doit se semer via `connection: { remotePeers: [...] }` (extrait avant le spread) '
            + 'ou `peerStore.setRoomMembers(contextId, [...])`, jamais par une clé spreadée.'
        )
    }


    // ── Lifecycle state (garde de teardown partagé) ───────────────────────────
    // Compteur ré-entrant, comme createPeerContext : `endShutdown` ne relâche le
    // garde que quand tous les arrêts en cours sont terminés.
    const lifecycle = reactive({
        shutdownCount: 0,
        ...(overrides.lifecycle ?? {}),
    })

    const beginShutdown = vi.fn(() => { lifecycle.shutdownCount += 1 })
    const endShutdown   = vi.fn(() => { lifecycle.shutdownCount = Math.max(0, lifecycle.shutdownCount - 1) })

    // ── Connection events ─────────────────────────────────────────────────────
    const connectionEvents = reactive({
        onConnectionOpen:  { callback: vi.fn(), isActive: false },
        onConnectionClose: { callback: vi.fn(), isActive: false },
        onConnectionError: { callback: vi.fn(), isActive: false },
        onDataReceived:    { callback: vi.fn(), isActive: false },
        onStreamReceived:  { callback: vi.fn(), isActive: false },
    })

    // ── Signals ───────────────────────────────────────────────────────────────
    // Le routage vit dans useSignalingQueue, qui n'observe que `lastRoomSignal` :
    // pas de SIGNAL_TYPES ni de file complète exposés (cf. createPeerContext).
    const _signalQueue = ref([])
    const lastRoomSignal = computed(() => _signalQueue.value.at(-1) ?? null)

    // ── peerStore mock ────────────────────────────────────────────────────────
    const _connections = {}
    const _players = []
    // ⚠️ De vraies Map, comme dans peers2/state.js — et la même FORME DE VALEUR pour
    // `remotePeersId` : `{ peerId, learnedAt }`. Le tampon n'est pas décoratif, c'est ce
    // que lit le bail (`getDialableRemotePeerId`) ; un mock qui stockerait la chaîne nue
    // rendrait toute entrée non composable et ferait rougir des tests pour la mauvaise
    // raison. `Debug.vue` itère aussi directement ces entrées.
    const _remotePeerIds = new Map()
    const _waitingRemotePeerIds = new Map()
    const _signalQueueRooms = {}
    // Registre des contextes montés. Une vraie Map, comme dans peers2/state.js — mais
    // NON réactive des deux côtés : le store réel la pose en `markRaw` précisément pour
    // que les valeurs ressorties soient les objets de contexte eux-mêmes et non des
    // proxies, dont les comparaisons d'identité (`unregisterContext`) échoueraient.
    const _contextRegistry = new Map()
    // Jetons des consommateurs du peer singleton — un Set, comme peers2/state.js.
    const _peerConsumers = new Set()

    // ── Peer local : UN seul fait, deux noms ──────────────────────────────────
    // Côté store réel, `getLocalPeer()` rend `this.localPeer` : impossible de les faire
    // diverger. Le double les portait en champs INDÉPENDANTS, et ça n'était pas visible
    // tant que rien ne lisait les deux — jusqu'à ce que `peerIdentity` (qui lit
    // `localPeer`) devienne le chemin de lecture des composables, alors que les tests
    // sèment `getLocalPeer`. Deux noms pour un fait, c'est un mock qui ment.
    //
    // ⚠️ Extraits des overrides AVANT le spread final, comme `connection.remotePeers` et
    // pour la même raison : spreadés, ils écraseraient les accesseurs par des valeurs
    // nues et rendraient la divergence possible à nouveau.
    const {
        localPeer: _seededLocalPeer,
        getLocalPeer: _seededLocalPeerAlias,
        ...peerStoreOverrides
    } = overrides.peerStore ?? {}

    let _localPeer = _seededLocalPeer ?? _seededLocalPeerAlias ?? null

    const peerStore = {
        lastLocalPeerId: peerStoreOverrides.lastLocalPeerId ?? null,
        // `getLocalPeerId` a disparu du store réel avec la FSM : « quel est mon peerId » ne se
        // répond plus sans dire dans quelle phase il est valable (cf. `peerIdentity`). Le
        // conserver ici ferait mentir le double, et `mockFidelity` le refuse — un membre que
        // le vrai store n'a pas.
        // ⚠️ Objet nu, PAS un computed : les getters Pinia sont auto-déballés, et le code
        // sous test lit `ctx.peerStore.getConnections?.[room]` sans `.value`. Enveloppé
        // dans un computed, tout accès retournait undefined → `hasOpenConnection`
        // systématiquement false (faux négatif silencieux).
        getConnections: _connections,
        getPlayers: _players,

        // Exposées telles quelles : la recovery du transport les parcourt directement.
        remotePeersId: _remotePeerIds,
        waitingRemotePeerId: _waitingRemotePeerIds,

        // ── Registre des contextes montés ─────────────────────────────────────
        // Mêmes deux gardes que le store réel, et ils ne sont PAS décoratifs :
        // last-write-wins à l'inscription (un contexte remonté reprend l'id de celui
        // qui se démonte), identité au retrait (sinon l'onUnmounted de l'ancien
        // effacerait l'entrée du nouveau, qui ne recevrait plus rien).
        contextRegistry: _contextRegistry,
        registerContext: vi.fn((registered) => {
            if (!registered?.contextId) return
            _contextRegistry.set(registered.contextId, registered)
        }),
        unregisterContext: vi.fn((registered) => {
            if (!registered?.contextId) return
            if (_contextRegistry.get(registered.contextId) === registered) {
                _contextRegistry.delete(registered.contextId)
            }
        }),
        getContextById: vi.fn((contextId) => {
            if (!contextId) return null
            return _contextRegistry.get(contextId) ?? null
        }),
        // Une FONCTION, comme le getter réel — dont le commentaire explique pourquoi :
        // sur une collection `markRaw`, un getter Pinia mis en cache figerait le registre.
        getRegisteredContexts: vi.fn(() => [..._contextRegistry.values()]),

        // ⚠️ `undefined` sur entrée absente, comme le vrai getter — c'est le `Map.get`
        // qu'il remplace, et sa docstring l'énonce. Le double rendait `null` : sans
        // conséquence sur la production (les deux lecteurs testent la truthiness ou
        // comparent à `conn.peer`), mais sept assertions épinglaient la valeur du DOUBLE
        // au lieu du contrat du store. Un mock qui ment est pire qu'un test manquant.
        getRemotePeerId: vi.fn((slug) => _remotePeerIds.get(slug)?.peerId),
        hasRemotePeerId: vi.fn((slug) => _remotePeerIds.has(slug)),
        addRemotePeerId: vi.fn((slug, peerId) => {
            _remotePeerIds.set(slug, { peerId, learnedAt: Date.now() })
        }),
        // Le bail, avec la constante du module et jamais un littéral — même doctrine que
        // `waitingPeerIdKey` importée plus haut : une seconde implémentation d'un contrat
        // partagé diverge sans jamais lever.
        //
        // ⚠️ Fail-closed comme le vrai getter : une entrée sans estampille numérique n'est
        // pas composable. Le choix inverse rendrait verts pour la mauvaise raison tous les
        // tests de composition dès qu'un double oublierait le tampon.
        getDialableRemotePeerId: vi.fn((slug) => {
            const entry = _remotePeerIds.get(slug)
            if (!entry?.peerId || typeof entry.learnedAt !== 'number') return undefined

            return (Date.now() - entry.learnedAt) < REMOTE_PEER_ID_LEASE_MS
                ? entry.peerId
                : undefined
        }),
        // Aveugle au bail, comme le vrai : la recovery `peer-unavailable` et
        // l'anti-usurpation par résolution inverse en dépendent.
        getSlugByRemotePeerId: vi.fn((peerId) => {
            if (!peerId) return null
            const wanted = String(peerId)
            for (const [slug, entry] of _remotePeerIds.entries()) {
                if (entry?.peerId && String(entry.peerId) === wanted) return slug
            }
            return null
        }),
        // Fidèle au store réel : le mapping n'est oublié que si le pair n'est déclaré
        // présent dans AUCUNE room de l'onglet. Le prédicat porte sur `roomMembers`
        // (présence), jamais sur `connections` (connexions PeerJS) — s'en écarter ici
        // rendrait verts des tests de purge qui ne prouveraient rien.
        removeRemotePeerId: vi.fn((slug) => {
            if (peerStore.isUserInAnyRoom(slug)) return
            _remotePeerIds.delete(slug)
        }),
        // Invalidation inconditionnelle : le peerId est mort, pas « peut-être encore
        // utile ailleurs ». Purge aussi TOUTES les demandes en vol pour ce pair (tous
        // contextes), sans quoi la re-demande serait étranglée par SIGNALING_STALE_MS.
        invalidateRemotePeerId: vi.fn((slug) => {
            _remotePeerIds.delete(slug)
            peerStore.clearWaitingRemotePeerIds(slug)
        }),

        // ── Composition des rooms (roomMembers) ───────────────────────────────
        // Source de la composition, pas index d'appoint : `connection.remotePeers` est un
        // accesseur au-dessus de ces entrées.
        roomMembers: _roomMembers,
        // Curryfié comme le vrai getter, et pour la même raison : il doit relire à chaque
        // appel. Rend `EMPTY_MEMBERS` — gelé, identité stable — pour un contexte muet.
        getRoomMembers: vi.fn((contextId) => {
            if (!contextId) return EMPTY_MEMBERS
            return _roomMembers[contextId] ?? EMPTY_MEMBERS
        }),
        // Diff ET écriture en un appel synchrone, comme le vrai. Le calcul est IMPORTÉ du
        // store, pas réécrit : c'est contre ce verbe que `usePeerConnections.test.js`
        // asserte les arrivées et les départs de la production.
        computeRoomDiff: vi.fn((contextId, nextSlugs = []) => {
            if (!contextId) return { newSlugs: [], removedSlugs: [] }

            const next = Array.isArray(nextSlugs) ? [...nextSlugs] : []
            const diff = diffRoomMembers(_roomMembers[contextId], next)

            _roomMembers[contextId] = next

            return diff
        }),
        setRoomMembers: vi.fn((contextId, slugs = []) => {
            if (!contextId) return
            _roomMembers[contextId] = Array.isArray(slugs) ? [...slugs] : []
        }),
        // Porte le MÊME garde de propriété que le vrai verbe, et pas par symétrie
        // décorative : sans lui, le double serait plus permissif que la production sur un
        // chemin de sécurité, et un test de la propriété « un mourant n'efface pas
        // l'allowlist de son homonyme vivant » passerait par ici en restant vert quoi qu'il
        // arrive au store. C'est la panne n° 2 de mockFidelity.test.js, mot pour mot.
        //
        // ⚠️ La sémantique est celle du store, pas celle de `unregisterContext` : on ne
        // s'abstient que si l'entrée appartient à QUELQU'UN D'AUTRE — un contexte jamais
        // inscrit purge la sienne.
        clearRoomMembers: vi.fn((contextId, owner = null) => {
            if (!contextId) return

            const holder = _contextRegistry.get(contextId)
            if (owner && holder && holder !== owner) return

            delete _roomMembers[contextId]
        }),
        isUserInAnyRoom: vi.fn((slug) => {
            if (!slug) return false
            return Object.values(_roomMembers).some(
                (slugs) => Array.isArray(slugs) && slugs.includes(slug)
            )
        }),

        // ── Demandes de peerId en vol — clé (slug, room, type) ────────────────
        // ⚠️ La clé composite EST le correctif : un mock indexé sur le slug seul
        // reproduirait la confiscation inter-contextes qu'on vient de supprimer.
        getWaitingRemotePeerId: vi.fn((slug, room = null, type = null) => (
            _waitingRemotePeerIds.get(waitingPeerIdKey(slug, room, type)) ?? null
        )),
        hasWaitingRemotePeerId: vi.fn((slug, room = null, type = null) => (
            _waitingRemotePeerIds.has(waitingPeerIdKey(slug, room, type))
        )),
        getWaitingRemotePeerIds: vi.fn((slug) => (
            [..._waitingRemotePeerIds.values()].filter((entry) => entry?.userSlug === slug)
        )),
        addWaitingRemotePeerId: vi.fn((slug, data = {}) => {
            _waitingRemotePeerIds.set(
                waitingPeerIdKey(slug, data?.room, data?.type),
                { ...data, userSlug: slug, createdAt: Date.now() },
            )
        }),
        removeWaitingRemotePeerId: vi.fn((slug, room = null, type = null) => {
            _waitingRemotePeerIds.delete(waitingPeerIdKey(slug, room, type))
        }),
        clearWaitingRemotePeerIds: vi.fn((slug, room = null) => {
            for (const [key, entry] of [..._waitingRemotePeerIds.entries()]) {
                if (entry?.userSlug !== slug) continue
                if (room !== null && entry?.room !== room) continue
                _waitingRemotePeerIds.delete(key)
            }
        }),
        clearWaitingRemotePeerIdsForContext: vi.fn((ctxId) => {
            if (!ctxId) return
            for (const [key, entry] of [..._waitingRemotePeerIds.entries()]) {
                if (entry?.contextId === ctxId) _waitingRemotePeerIds.delete(key)
            }
        }),

        // Peer local : `usePeerTransport` lit et écrit ce membre directement, et
        // `getLocalPeer` en est l'ALIAS — le même objet, comme dans le store réel.
        get localPeer() { return _localPeer },
        set localPeer(peer) { _localPeer = peer },
        get getLocalPeer() { return _localPeer },
        set getLocalPeer(peer) { _localPeer = peer },

        // La phase déclarée, comme le store réel — écrite par les transitions ci-dessous et
        // par elles seules. Le double NE pré-sème PAS un peer prêt : les tests du transport
        // comptent sur `localPeer === null` pour que `setLocalPeer` construise réellement une
        // instance. Un test qui a besoin d'un peer joignable le sème (`seedReadyPeer`).
        peerPhase: peerStoreOverrides.peerPhase ?? PEER_PHASES.ABSENT,

        // ─── Runtime du Peer singleton ────────────────────────────────────────
        // Ref-counting, garde d'init et reconnexion : cet état vit dans le store réel
        // (cf. stores/peers2/state.js) précisément pour ne PAS dépendre de la durée de
        // vie du module `usePeerTransport`. Le mock doit donc compter pour de vrai —
        // des `vi.fn()` vides rendraient verts des tests de destruction différée qui
        // ne prouveraient plus rien.
        peerInitPromise: peerStoreOverrides.peerInitPromise ?? null,
        peerReconnectAttempts: peerStoreOverrides.peerReconnectAttempts ?? 0,
        peerDestroyTimer: peerStoreOverrides.peerDestroyTimer ?? null,
        peerReconnectTimer: peerStoreOverrides.peerReconnectTimer ?? null,
        peerIceRefreshTimer: peerStoreOverrides.peerIceRefreshTimer ?? null,
        peerIceRefreshAttempts: peerStoreOverrides.peerIceRefreshAttempts ?? 0,
        peerListenersDetach: peerStoreOverrides.peerListenersDetach ?? null,

        // ⚠️ Des JETONS, comme le store réel, et le `null` de retour est le point de
        // fidélité qui compte : un retrait de jeton inconnu rend `null` (« rien à
        // conclure »), jamais `0`. Reproduire un compteur planché ici rendrait vert un
        // appelant qui testerait `<= 0` — c'est-à-dire exactement le bug corrigé, qui
        // permettait de détruire un Peer encore consommé.
        peerConsumers: _peerConsumers,
        addPeerConsumer: vi.fn((token) => {
            if (token === undefined || token === null) return _peerConsumers.size
            _peerConsumers.add(token)
            return _peerConsumers.size
        }),
        removePeerConsumer: vi.fn((token) => {
            if (!_peerConsumers.delete(token)) return null
            return _peerConsumers.size
        }),

        // ── Observabilité de l'état du Peer ───────────────────────────────────
        // La logique est DUPLIQUÉE du store réel, à contre-cœur mais à dessein : c'est le
        // seul fait dérivé que le transport journalise, et un mock qui rendrait un état
        // constant ferait taire l'audit exactement là où il doit crier. Les deux
        // implémentations sont épinglées par les mêmes codes de violation.
        //
        // ⚠️ Des FONCTIONS, comme les getters réels : `localPeer` porte un Peer `markRaw`,
        // donc un `computed` servirait un état partiellement périmé.
        peerIdentity: vi.fn(() => {
            const peer = peerStore.localPeer
            const id = (typeof peer?.id === 'string') ? peer.id : null
            const base = { id, lastId: peerStore.lastLocalPeerId, consumers: _peerConsumers.size }

            if (!peer) {
                return { state: peerStore.peerPhase === PEER_PHASES.CREATING ? 'creating' : 'absent', ...base }
            }
            if (peer.destroyed) return { state: 'destroyed', ...base }
            if (peer.disconnected) return { state: 'disconnected', ...base }
            return { state: peerStore.peerPhase === PEER_PHASES.READY ? 'ready' : 'connecting', ...base }
        }),
        peerStateViolations: vi.fn(() => {
            const peer = peerStore.localPeer
            const violations = []
            const add = (code, message) => violations.push({ code, message })

            if (peerStore.peerPhase === PEER_PHASES.READY && !peer) {
                add('pret-sans-peer', 'la phase est `ready` alors que localPeer est nul')
            }
            if (peerStore.lastLocalPeerId && !peer && peerStore.peerPhase !== PEER_PHASES.CREATING) {
                add('id-historique-sans-peer', 'lastLocalPeerId est posé alors qu\'aucun peer n\'existe et qu\'aucune init n\'est en vol')
            }
            if (peer && peerStore.peerPhase === PEER_PHASES.READY && typeof peer.id !== 'string') {
                add('pret-sans-id', 'la phase est `ready` alors que le peer n\'a pas d\'id utilisable')
            }
            if (peerStore.lastLocalPeerId && peer && (peer.destroyed || (peer.disconnected && !peerStore.peerReconnectTimer))) {
                add('id-historique-sur-peer-inutilisable', 'lastLocalPeerId est posé sur un peer détruit ou déconnecté sans reconnexion en vol')
            }
            if (peer?.destroyed && peerStore.peerPhase === PEER_PHASES.READY) {
                add('pret-mais-detruit', 'la phase est `ready` sur un peer détruit')
            }
            if (peer && !peer.destroyed && _peerConsumers.size === 0 && !peerStore.peerDestroyTimer) {
                add('peer-orphelin', 'un peer vivant n\'a plus aucun consommateur et aucune destruction n\'est armée')
            }
            return violations
        }),
        auditPeerState: vi.fn((where = '?') => {
            const violations = peerStore.peerStateViolations()
            if (violations.length === 0) return violations
            console.error(
                `[WebRTC2][invariant] ${where} — ${violations.length} contradiction(s) dans l'état du Peer :`,
                { identity: peerStore.peerIdentity(), violations }
            )
            return violations
        }),

        // ── Transitions de phase ──────────────────────────────────────────────
        // Mêmes verbes que le store réel, et la même règle : la transition inattendue est
        // APPLIQUÉE puis journalisée, jamais refusée (cf. l'en-tête de peers2/phases.js).
        // Un double qui refuserait figerait la phase et rendrait verts des tests décrivant
        // un peer que la production n'a jamais.
        setPeerPhase: vi.fn((to, where = '?') => {
            if (!isExpectedPeerPhaseTransition(peerStore.peerPhase, to)) {
                console.warn(
                    `[WebRTC2][peerFSM] Transition inattendue : ${peerStore.peerPhase} → ${to} (${where}) — appliquée quand même`
                )
            }
            peerStore.peerPhase = to
            return to
        }),
        markPeerCreating: vi.fn(() => peerStore.setPeerPhase(PEER_PHASES.CREATING, 'début d\'init')),
        markPeerConnecting: vi.fn(() => peerStore.setPeerPhase(PEER_PHASES.CONNECTING, 'Peer construit')),
        markPeerOpen: vi.fn((id = null) => {
            if (typeof id === 'string' && id.length > 0) peerStore.lastLocalPeerId = id
            peerStore.resetReconnectAttempts()
            return peerStore.setPeerPhase(PEER_PHASES.READY, 'après \'open\' du Peer')
        }),
        markPeerDisconnected: vi.fn(() => peerStore.setPeerPhase(PEER_PHASES.DISCONNECTED, 'après \'disconnected\' du Peer')),
        markPeerAbsent: vi.fn((where = 'Peer abandonné') => peerStore.setPeerPhase(PEER_PHASES.ABSENT, where)),

        setPeerInitPromise: vi.fn((promise = null) => { peerStore.peerInitPromise = promise }),
        resetReconnectAttempts: vi.fn(() => { peerStore.peerReconnectAttempts = 0 }),
        incrementReconnectAttempts: vi.fn(() => {
            peerStore.peerReconnectAttempts += 1
            return peerStore.peerReconnectAttempts
        }),
        // Retournent un booléen « un timer était bien armé » : le transport ne loggue
        // l'annulation de la destruction que dans ce cas.
        clearPeerDestroyTimer: vi.fn(() => {
            if (!peerStore.peerDestroyTimer) return false
            clearTimeout(peerStore.peerDestroyTimer)
            peerStore.peerDestroyTimer = null
            return true
        }),
        clearReconnectTimer: vi.fn(() => {
            if (!peerStore.peerReconnectTimer) return false
            clearTimeout(peerStore.peerReconnectTimer)
            peerStore.peerReconnectTimer = null
            return true
        }),
        clearIceRefreshTimer: vi.fn(() => {
            if (!peerStore.peerIceRefreshTimer) return false
            clearTimeout(peerStore.peerIceRefreshTimer)
            peerStore.peerIceRefreshTimer = null
            return true
        }),
        resetIceRefreshAttempts: vi.fn(() => { peerStore.peerIceRefreshAttempts = 0 }),
        incrementIceRefreshAttempts: vi.fn(() => {
            peerStore.peerIceRefreshAttempts += 1
            return peerStore.peerIceRefreshAttempts
        }),
        // Contrat du store réel reproduit à l'identique — sinon `mockFidelity` garantirait
        // la surface et laisserait passer le mensonge : remplacer une closure **exécute** la
        // précédente, et le détachement vide le champ AVANT d'appeler (jamais rejouer une
        // closure qui a jeté). Des `vi.fn()` vides rendraient verts des tests de destruction
        // qui ne prouveraient plus rien.
        setPeerListenersDetach: vi.fn((detach = null) => {
            peerStore.detachPeerListeners()
            peerStore.peerListenersDetach = detach
        }),
        detachPeerListeners: vi.fn(() => {
            const detach = peerStore.peerListenersDetach
            peerStore.peerListenersDetach = null
            if (typeof detach !== 'function') return false
            try { detach() } catch (e) { /* absorbée comme dans le store réel */ }
            return true
        }),

        // ⚠️ Ne touche PAS aux consommateurs, comme le store réel : un consommateur est un
        // composant monté, pas une propriété du Peer. C'est ce qui a rendu l'ancien
        // paramètre `keepConsumerCount` sans objet.
        resetPeerState: vi.fn(() => {
            peerStore.detachPeerListeners()
            peerStore.localPeer = null
            // Affectation directe, comme le store réel : un reset n'est pas une transition.
            peerStore.peerPhase = PEER_PHASES.ABSENT
            peerStore.lastLocalPeerId = null
            peerStore.peerInitPromise = null
            peerStore.peerReconnectAttempts = 0
            peerStore.clearPeerDestroyTimer()
            peerStore.clearReconnectTimer()
            peerStore.clearIceRefreshTimer()
            peerStore.peerIceRefreshAttempts = 0
        }),

        // File de signaux brute : lue par `useSignalingQueue` (détecteur de coalescence).
        signalQueues: _signalQueueRooms,

        getQueueForRoom: vi.fn((room) => _signalQueueRooms[room] ?? []),
        getLastRoomSignal: vi.fn((room) => _signalQueueRooms[room]?.at(-1) ?? null),
        createSignalQueueRoom: vi.fn((room) => { _signalQueueRooms[room] = [] }),
        clearSignalQueueRoom: vi.fn((room) => { delete _signalQueueRooms[room] }),

        // Prépare la structure imbriquée room → slug → type → [] à partir du `config`
        // produit par _buildPeerConnectionConfig (cf. peers2/actions.js:15).
        prepareRoomConnection: vi.fn((payload) => {
            const { room, slug, type } = payload?.options?.metadata ?? {}
            if (!_connections[room]) _connections[room] = {}
            if (!_connections[room][slug]) _connections[room][slug] = {}
            if (!_connections[room][slug][type]) _connections[room][slug][type] = []
        }),
        storePeerConnection: vi.fn((room, slug, type, conn) => {
            _connections[room][slug][type].push(conn)
        }),
        // Ferme les instances sans les retirer du store — le retrait est le rôle de
        // clearConnectionsRoom / removePeerConnectionInstance (cf. peers2/actions.js:80).
        closePeerConnection: vi.fn((room, slug, type) => {
            const list = _connections[room]?.[slug]?.[type]
            if (!Array.isArray(list)) return
            list.forEach((conn) => {
                if (!conn || typeof conn !== 'object') return
                if (conn.__ctxClosing === true || conn.__ctxCloseHandled === true) return
                if (!Object.hasOwn(conn, 'peer')) return
                if (type === 'data' && conn.open !== true) return
                conn.__ctxClosing = true
                conn.close?.()
                if (type !== 'data' && conn.peerConnection?.signalingState !== 'closed') {
                    conn.peerConnection?.close?.()
                }
            })
        }),

        // ⚠️ HELPER DE TEST — n'existe PAS sur le store réel (cf. mockFidelity.test.js).
        // Raccourci de `prepareRoomConnection` + `storePeerConnection`, pour injecter une
        // connexion factice en une ligne. Produit exactement la même structure que ces
        // deux actions ; toute divergence en ferait un mock qui ment.
        addPeerConnectionInstance: vi.fn((room, slug, type, conn) => {
            if (!_connections[room]) _connections[room] = {}
            if (!_connections[room][slug]) _connections[room][slug] = {}
            if (!_connections[room][slug][type]) _connections[room][slug][type] = []
            _connections[room][slug][type].push(conn)
        }),
        removePeerConnectionInstance: vi.fn((room, slug, type, conn) => {
            const list = _connections[room]?.[slug]?.[type]
            if (!list) return
            const idx = list.indexOf(conn)
            if (idx !== -1) list.splice(idx, 1)
            if (list.length === 0) peerStore.clearConnectionsRoom(room, slug, type)
        }),
        // Fidèle au store réel : supprime la clé et remonte la purge sur les parents
        // devenus vides (cf. peers2/actions.js:154) — un slug sans type disparaît de la
        // room, ce dont dépend removeRemotePeerId.
        clearConnectionsRoom: vi.fn((room, slug, type) => {
            if (!_connections[room]?.[slug]) return
            delete _connections[room][slug][type]
            if (Object.keys(_connections[room][slug]).length === 0) delete _connections[room][slug]
            if (Object.keys(_connections[room]).length === 0) delete _connections[room]
        }),

        // `setLocalPeer` / `setLocalPeerReady` / `setLastLocalPeerId` retirés avec la FSM :
        // ces trois setters du store réel n'avaient AUCUN appelant (le transport écrivait les
        // champs en direct), et les transitions les remplacent.
        addPlayer: vi.fn((player) => { _players.push(player) }),
        removePlayer: vi.fn((videoId) => {
            const idx = _players.findIndex((p) => p.videoId === videoId)
            if (idx !== -1) _players.splice(idx, 1)
        }),

        // Permet d'injecter des données dans le signalQueue pour simuler un signal entrant
        _pushSignal: (signal) => { _signalQueue.value = [..._signalQueue.value, signal] },
        _clearSignals: () => { _signalQueue.value = [] },

        ...peerStoreOverrides,
    }

    // Même garde structurel que pour `connection.remotePeers`, et il vaut pour les deux
    // noms : le jour où un override reprend le chemin du spread, `localPeer` et
    // `getLocalPeer` redeviendraient deux champs indépendants — un test sèmerait l'un et le
    // code sous test lirait l'autre, sans que rien ne le dise.
    for (const alias of ['localPeer', 'getLocalPeer']) {
        if (typeof Object.getOwnPropertyDescriptor(peerStore, alias)?.get !== 'function') {
            throw new Error(
                `createMockContext: \`peerStore.${alias}\` a perdu son accesseur — les deux noms `
                + 'désignent LE MÊME peer (comme dans le store réel) et doivent être semés via '
                + '`peerStore: { localPeer }` (extrait avant le spread), jamais par une clé spreadée.'
            )
        }
    }

    // ── meStore mock ──────────────────────────────────────────────────────────
    const meStore = {
        getMe: overrides.meStore?.getMe ?? { slug: 'test-user', name: 'Test User' },
        ...(overrides.meStore ?? {}),
    }

    // ── serverStore mock ──────────────────────────────────────────────────────
    const serverStore = {
        getServer: overrides.serverStore?.getServer ?? null,
        ...(overrides.serverStore ?? {}),
    }

    // ── AjaxService mock ──────────────────────────────────────────────────────
    const AjaxService = {
        load: vi.fn().mockResolvedValue({ data: {} }),
        ...(overrides.AjaxService ?? {}),
    }

    // ── Computed (projections read-only) ──────────────────────────────────────
    const currentType        = computed(() => session.currentType)
    const currentRoom        = computed(() => session.currentRoom)
    const onAirRoom          = computed(() => session.onAirRoom)
    const currentCallRoomId  = computed(() => session.currentCallRoomId)
    const currentCallUsers   = computed(() => session.currentCallUsers)
    const remotePeers        = computed(() => connection.remotePeers)
    const topology           = computed(() => session.topology)
    const hubSlug            = computed(() => session.hubSlug)
    const isHub              = computed(() => session.isHub)
    // Copie conforme de la production : les deux moitiés du prédicat dites séparément.
    const isHubConnected     = computed(() => {
        if (!session.hubSlug) return false
        return session.hubSlug === meStore.getMe?.slug
            || connection.remotePeers.includes(session.hubSlug)
    })
    const currentStream      = computed(() => media.currentStream)
    const isStreaming        = computed(() => media.isStreaming)
    const isCapturing        = computed(() => media.isCapturing)
    // Même dérivation que `createPeerContext` : le prédicat « je diffuse » est par pair, pas
    // par type. Lu par usePeerCore (émission sur les routes de peerId) et par
    // useBroadcastPresence — un mock qui l'oublierait leur servirait `undefined.value`.
    const isBroadcasting     = computed(() => !!(media.isStreaming || media.isCapturing))
    const announcedStreamPeers = computed(() => Array.from(media.announcedStreamsMap.keys()))
    const mySlug             = computed(() => meStore.getMe?.slug)
    const myName             = computed(() => meStore.getMe?.name)

    // ── Signal peerUnavailable ────────────────────────────────────────────────
    const peerUnavailableSignal = ref(null)

    // ── Signal inviteAbandoned ────────────────────────────────────────────────
    const inviteAbandonedSignal = ref(null)

    // ── Signal connectionLost ─────────────────────────────────────────────────
    // Écrit par handleClose sur le vrai contexte ; ici c'est le test qui l'écrit pour
    // simuler la chute d'une connexion. Doit rester un `ref` : le watch du pool s'y
    // accroche, et un mock qui l'oublierait le laisserait observer `undefined`.
    const connectionLostSignal = ref(null)

    // ── waitForMeReady ────────────────────────────────────────────────────────
    // Dans les tests on résout immédiatement sauf override explicite (ex: tester le timeout)
    const waitForMeReady = overrides.waitForMeReady
        ?? vi.fn().mockResolvedValue(true)

    // ── waitForPresenceSync ───────────────────────────────────────────────────
    // Fidèle au contexte réel : résout `true` sans attendre quand la présence est déjà
    // connue, sinon dès qu'elle le devient. Pas de timeout ici — c'est le test qui
    // décide quand la présence arrive ; un test qui veut le refus sans jamais
    // synchroniser garde le défaut `presenceSynced: true` (chemin rapide) ou passe son
    // propre override.
    const waitForPresenceSync = overrides.waitForPresenceSync ?? vi.fn(() => {
        if (connection.presenceSynced) return Promise.resolve(true)
        return new Promise((resolve) => {
            const stop = watch(() => connection.presenceSynced, (synced) => {
                if (!synced) return
                stop()
                resolve(true)
            })
        })
    })

    // ── setUpConnectionListeners (passthrough minimal) ────────────────────────
    const setUpConnectionListeners = vi.fn(() => () => {})

    // ── storeConnectionEventCallbacks ─────────────────────────────────────────
    const storeConnectionEventCallbacks = vi.fn((callbacks) => {
        if (!callbacks || typeof callbacks !== 'object') return
        Object.keys(callbacks).forEach((key) => {
            const entry = connectionEvents[key]
            if (entry && typeof callbacks[key] === 'function' && !entry.isActive) {
                entry.callback = callbacks[key]
                entry.isActive = true
            }
        })
    })

    // ── currentCallUsers helpers ──────────────────────────────────────────────
    const setCurrentCallUsers = (users = []) => {
        session.currentCallUsers = Array.isArray(users) ? users : []
        return session.currentCallUsers
    }
    const addCurrentCallUser = (userSlug, type = 'visio') => {
        if (!userSlug) return session.currentCallUsers
        const exists = session.currentCallUsers.some(
            (u) => u.userSlug === userSlug && u.type === type
        )
        if (!exists) {
            session.currentCallUsers = [...session.currentCallUsers, { userSlug, type }]
        }
        return session.currentCallUsers
    }
    const removeCurrentCallUser = (userSlug) => {
        if (!userSlug) return session.currentCallUsers
        session.currentCallUsers = session.currentCallUsers.filter((u) => u.userSlug !== userSlug)
        return session.currentCallUsers
    }
    const clearCurrentCallUsers = () => {
        session.currentCallUsers = []
        return session.currentCallUsers
    }

    // ── announcedStreams helpers ──────────────────────────────────────────────
    // Fidèles aux accesseurs de createPeerContext : slug valide et jamais soi-même.
    const markAnnouncedStream = vi.fn((userSlug, source = 'signal') => {
        if (!isValidSlug(userSlug)) return false
        if (userSlug === meStore.getMe?.slug) return false
        media.announcedStreamsMap.set(userSlug, { source, at: Date.now() })
        return true
    })
    const clearAnnouncedStream = vi.fn((userSlug) => {
        if (!userSlug) return false
        return media.announcedStreamsMap.delete(userSlug)
    })

    // ── authorizedCallPeers helpers ───────────────────────────────────────────
    // Allowlist du garde sortant. Fidèles aux accesseurs de createPeerContext :
    // slug valide, jamais soi-même, jamais d'écriture directe. Un mock permissif ici
    // rendrait vert un garde qui ne garde rien.
    const markAuthorizedCallPeer = vi.fn((userSlug) => {
        if (!isValidSlug(userSlug)) return false
        if (userSlug === meStore.getMe?.slug) return false
        session.authorizedCallPeers.set(userSlug, { at: Date.now() })
        return true
    })
    const isAuthorizedCallPeer = vi.fn((userSlug) => {
        if (!userSlug) return false
        return session.authorizedCallPeers.has(userSlug)
    })
    const clearAuthorizedCallPeer = vi.fn((userSlug) => {
        if (!userSlug) return false
        return session.authorizedCallPeers.delete(userSlug)
    })
    const clearAllAuthorizedCallPeers = vi.fn(() => {
        session.authorizedCallPeers.clear()
    })

    // ── destroy ───────────────────────────────────────────────────────────────
    const destroy = vi.fn(() => {
        media.remoteStreamsMap.clear()
        media.announcedStreamsMap.clear()
        media.currentStream = null
        session.currentCallUsers = []
        media.isStreaming = false
        media.isCapturing = false
        callMachine.reset()
        // Comme `createPeerContext.destroy` : un contexte détruit ne témoigne plus de la
        // présence de personne, donc son entrée DISPARAÎT — elle ne devient pas « room
        // vide ». Le double posait un `[]`, écart sans conséquence sur les lectures mais
        // qui aurait fait divergier la seule chose que cette entrée gouverne encore après
        // la mort du contexte : `isUserInAnyRoom`, qui balaie tous les contextes.
        //
        // ⚠️ Se présente comme le vrai `destroy()`. `ctx` est la liaison retournée plus
        // bas — c'est elle qu'un test inscrit au registre, donc c'est elle qui prouve la
        // propriété de l'entrée.
        peerStore.clearRoomMembers(contextId, ctx)
        connection.presenceSynced = false
        session.authorizedCallPeers.clear()
    })

    // Liaison NOMMÉE, comme `createPeerContext` : c'est cet objet-ci qu'un test inscrit au
    // registre, donc c'est lui que `destroy()` doit présenter à `clearRoomMembers`.
    const ctx = {
        contextId,
        lastRoomSignal,

        // infra
        peerStore,
        meStore,
        serverStore,
        AjaxService,
        eventBus,

        // state
        session,
        media,
        ui,
        connection,
        lifecycle,
        connectionEvents,

        // FSM
        callMachine,

        // computed
        currentType,
        currentRoom,
        onAirRoom,
        currentCallRoomId,
        currentCallUsers,
        callInprogress: callMachine.callInprogress,
        callStatus: computed(() => callMachine.callState.value),
        isShuttingDown: computed(() => lifecycle.shutdownCount > 0),
        remotePeers,
        topology,
        hubSlug,
        isHub,
        isHubConnected,
        currentStream,
        isStreaming,
        isCapturing,
        isBroadcasting,
        announcedStreamPeers,
        mySlug,
        myName,

        // helpers
        waitForMeReady,
        waitForPresenceSync,
        beginShutdown,
        endShutdown,
        setUpConnectionListeners,
        storeConnectionEventCallbacks,
        setCurrentCallUsers,
        addCurrentCallUser,
        removeCurrentCallUser,
        clearCurrentCallUsers,
        markAnnouncedStream,
        clearAnnouncedStream,
        markAuthorizedCallPeer,
        isAuthorizedCallPeer,
        clearAuthorizedCallPeer,
        clearAllAuthorizedCallPeers,

        // signaux réactifs
        peerUnavailableSignal,
        inviteAbandonedSignal,
        connectionLostSignal,

        // destroy
        destroy,
    }

    return ctx
}
