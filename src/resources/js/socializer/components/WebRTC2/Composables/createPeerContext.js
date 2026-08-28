/**
 * 🧱 createPeerContext (Context Factory)
 *
 * 👉 gère :
 * - création d’une instance isolée du système peer
 * - centralisation des dépendances (stores, services, eventBus)
 * - stockage des états partagés (session, media, connections, ui)
 *
 * 👉 garantit :
 * - aucune dépendance implicite (tout est injecté ici)
 * - isolation entre plusieurs instances (multi-room, multi-type)
 *
 * 👉 ne fait PAS :
 * - logique métier
 * - logique réseau
 * - manipulation directe des streams
 *
 * 👉 rôle :
 * - fournir une "source de vérité" unique à tous les composables techniques
 */

import { reactive, computed, ref, inject, onBeforeMount, onUnmounted, watchEffect, effectScope, shallowReactive, markRaw } from 'vue'
import { useAjaxService } from '~estarter/services/AjaxService.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useServerStore } from '~socializer/stores/server.js'
import { useMeStore } from '~estarter/stores/me.js'
import { createCallStateMachine } from '~socializer/components/WebRTC2/Composables/utils/useCallStateMachine.js'
import { isValidSlug } from '~socializer/components/WebRTC2/Composables/utils/validators.js'
import { isPayloadWithinLimit } from '~socializer/components/WebRTC2/Composables/utils/payloadSize.js'
import { sanitizeMetadataType } from '~socializer/components/WebRTC2/Composables/utils/sanitizeMetadata.js'
import { ME_READY_TIMEOUT_MS, PRESENCE_SYNC_TIMEOUT_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

// `options = {}` par défaut : `options.topology` / `options.hubSlug` /
// `options.videoContainer` étaient lus SANS optional chaining alors que
// `options?.meReadyTimeoutMs` en avait un — `createPeerContext({ type, room })` jetait
// donc un TypeError, contredisant une signature qui suggérait l'inverse. Aucun appelant
// n'était concerné (l'orchestrateur passe toujours `options`), mais l'asymétrie était un
// piège. Tranché en faveur de la valeur par défaut : un seul endroit à tenir.
export function createPeerContext({ type, room, options = {} }) {

    const contextId = `${type}-${room}`

    // MACHINE D'ÉTAT D'APPEL
    // Remplace les trois flags éparpillés : callInprogress, isStoppingCall, closingUsers.
    const callMachine = createCallStateMachine(contextId)

    // Guard défensif : si eventBus absent ou invalide, utiliser un no-op
    // pour éviter les crashes silencieux sur ctx.eventBus.$emit/on/off(...).
    const _bus = inject('eventBus', null)
    const _isValidBus = _bus && typeof _bus.$emit === 'function' && typeof _bus.$on === 'function' && typeof _bus.$off === 'function'

    if (!_isValidBus) {
        console.warn('[WebRTC2] createPeerContext: eventBus non fourni ou invalide — les événements ne seront pas propagés.')
    }

    const _safeEventBus = _isValidBus ? _bus : { $emit: () => {}, $on: () => {}, $off: () => {} }

    // STORES (infra)
    const peerStore = usePeer2Store()
    const meStore = useMeStore()
    const serverStore = useServerStore()
    const AjaxService = useAjaxService()

    // SESSION STATE (runtime)
    const session = reactive({
        currentType: type || 'data',
        currentRoom: room || 'app',
        onAirRoom: room || 'app',
        currentCallRoomId: null, // roomId spécifique pour les appels audio/vidéo (différent de currentRoom qui est la room "logique")
        currentCallUsers: [], // liste des slugs des utilisateurs actuellement en appel avec moi (utile pour gérer les connexions et l'UI d'appel)
        // Pairs avec qui un appel direct a été AUTORISÉ (clé: slug, valeur: { at }).
        // Registre de sécurité, à propriétaire unique (useCallManager) — voir les
        // accesseurs plus bas pour la raison d'être distincte de `currentCallUsers`.
        authorizedCallPeers: new Map(),
        topology: options.topology || 'mesh', // topologie de diffusion : 'mesh' (pair à pair), 'star' (étoile) ou 'sfu' (serveur de diffusion)
        hubSlug: options.hubSlug || null, // slug du hub de diffusion (si utilisé)
        isHub: null, // le peer est-il le hub de diffusion ? (si hubSlug fourni)
    })

    // MEDIA STATE
    const media = reactive({
        videoContainer: options.videoContainer || '#videoContainer', // conteneur HTML pour l'affichage des flux vidéo
        currentStream: null,
        screenStream: null,
        remoteStreamsMap: shallowReactive(new Map()), // Map pour stocker les flux distants avec une clé composite (userSlug-type) pour éviter les collisions
        // Pairs dont un flux est ANNONCÉ mais pas encore reçu (clé: slug du pair).
        // Réponse exacte à « ai-je une raison d'attendre un flux de ce pair ? », que
        // `remotePeers` ne peut pas donner (il liste les présents, diffuseurs ou non).
        // Deux écrivains, chacun sur la seule information qu'il voit passer — cf. la
        // table des propriétaires dans CONVENTIONS.md :
        //   - useBroadcastPresence : ses trois chemins d'annonce (`BROADCAST_STATE` sur le
        //                            data channel, `isBroadcasting` embarqué sur les deux
        //                            routes de peerId, whisper sur le canal de présence)
        //   - usePeerTransport     : appel one-way entrant (`peer.on('call')`), qui
        //                            n'existe que si le distant a un flux vivant
        // Vidé au départ du pair (useCallManager.handleRemoteDeparture).
        announcedStreamsMap: shallowReactive(new Map()),
        isStreaming: false,
        isCapturing: false,
        isAudioStream: false, // flag pour différencier les flux audio des flux vidéo (utile pour l'UI et la gestion des streams)
    })

    // UI STATE
    const ui = reactive({
        streamStates: {
            isMuted: false,
            isVideoEnabled: true,
        }
    })

    // CONNECTION STATE
    const connection = reactive({
        // Les pairs DISTANTS de la room, en slugs — mon propre slug en est filtré à la
        // source (usePeerConnections.getRoomUsersDiff). Le nom dit l'exclusion parce
        // que tous les lecteurs en dépendent : c'est « les pairs auxquels je dois me
        // connecter », pas « les membres de la room ». C'est aussi l'allowlist du
        // chemin (a) des deux gardes d'autorisation.
        //
        // ⚠️ ACCESSEUR, pas champ : la composition vit dans `peerStore.roomMembers[contextId]`
        // et n'a plus qu'un domicile. Elle en a eu deux — ce champ et sa projection dans le
        // store —, tenus synchrones par la seule discipline « les deux écritures restent dans
        // la même fonction », et il n'y avait aucun garde structurel derrière cette phrase.
        //
        // ⚠️ Aucun setter, volontairement : une écriture lève (`TypeError` de piège `set`,
        // le code de module étant en mode strict). C'est la parade au mode de panne qui a
        // coûté la passe de renommage précédente — les deux gardes lisent
        // `Array.isArray(…) ? … : []`, donc une écriture qui manquerait sa cible ne
        // casserait rien, elle rendrait la composition invisible et basculerait le verdict
        // vers « refusé », que la moitié des tests d'autorisation attend déjà. L'unique
        // écrivain de production est `peerStore.computeRoomDiff`.
        get remotePeers() {
            return peerStore.getRoomMembers(contextId)
        },

        // La composition de la room a-t-elle été OBSERVÉE au moins une fois ?
        //
        // ⚠️ Distinct de `remotePeers.length > 0`, et c'est tout l'intérêt : un tableau
        // vide ne dit pas « personne n'est membre », il dit « je ne sais pas encore ».
        // Les gardes d'admission lisent cette différence — refuser sur « je ne sais pas »
        // ferme la porte à tout contact légitime reçu pendant le démarrage du contexte.
        //
        // Écrit au même endroit que la composition — `usePeerConnections.getRoomUsersDiff`,
        // qui reste l'écrivain unique des deux, quoiqu'ils vivent désormais dans des
        // domiciles distincts : ce drapeau ici, la composition dans le store.
        // Mais les deux n'avancent PAS au même rythme : un tour de synchronisation sur
        // liste vide réécrit la liste (c'est ce qui purge une room qui se vide) sans rien
        // déclarer connu. L'invariant que l'écrivain unique garantit est donc directionnel
        // — la connaissance n'avance jamais sans la liste — et non simultané.
        presenceSynced: false,

        // Annuaire `user_id` → slug des membres observés de la room (clés en STRING).
        //
        // Sert un seul besoin, et il est de sécurité : un client event Reverb (whisper)
        // n'est attribuable que par le `user_id` que le serveur régénère sur l'enveloppe
        // (`accept_client_events_from: 'members'`), or tout le reste du module raisonne en
        // slugs. Sans annuaire, la seule identité disponible dans une charge utile de
        // whisper serait celle que l'émetteur a écrite — ce que `securite.md` interdit.
        //
        // Même écrivain unique que `remotePeers`, au même endroit et au même tour : la
        // seule source qui porte les deux champs est la liste de présence
        // (`Http/Resources/PresenceUser` : `id` ET `slug`).
        //
        // `markRaw` volontaire, et pas de la décoration : `reactive()` convertit les Map
        // imbriquées en collections réactives, si bien qu'un `.set()` par tour de présence
        // réveillerait tout `computed` qui l'aurait lue. Cet annuaire n'est lu
        // qu'impérativement, à la réception d'un whisper — il n'a aucune raison de
        // participer à la réactivité, et toutes les raisons de ne pas y participer.
        slugByUserId: markRaw(new Map()),
    })


    // LIFECYCLE STATE
    // Garde de teardown partagé : écrit par la couche appels (useCallManager) et par
    // les arrêts de stream, lu par la couche connexions (useConnectionPool) pour ne
    // relancer aucun retry pendant un cleanup. Vit ici parce que les deux couches
    // vivent dans des fichiers distincts.
    //
    // ⚠️ Compteur, pas booléen : le garde doit être ré-entrant. Plusieurs arrêts
    // peuvent se chevaucher (deux départs de pairs concurrents → deux arrêts
    // partiels, un arrêt de stream pendant un raccroché…) ; avec un booléen, le
    // premier `endShutdown` réautorisait les retries alors que le second arrêt
    // était encore en vol.
    //
    // Corollaire volontaire : un `beginShutdown` sans `endShutdown` laisse le garde
    // actif pour de bon — c'est exactement ce qu'attendent les teardowns terminaux
    // (`cleanupPeerConnection`, `onUnmounted` de useConnectionPool).
    const lifecycle = reactive({
        shutdownCount: 0,
    })

    // Accesseurs plutôt qu'écriture directe, pour la même raison que closingUsers
    // dans callMachine : éviter la corruption depuis l'extérieur.
    const beginShutdown = () => { lifecycle.shutdownCount += 1 }
    // Plancher à 0 : un `endShutdown` orphelin (chemin d'erreur, double finally)
    // ne doit jamais rendre le compteur négatif, sinon un arrêt légitime suivant
    // ne réactiverait plus le garde.
    const endShutdown   = () => { lifecycle.shutdownCount = Math.max(0, lifecycle.shutdownCount - 1) }

    // Dernier signal reçu pour la room — seule source observée par useSignalingQueue,
    // qui détient la table de routage type de signal → handler.
    // ⚠️ Ne PAS exposer ici la file complète sous forme de
    // `computed(() => peerStore.getQueueForRoom(contextId))` : ce computed ne tracerait
    // que la *clé* `signalQueues[contextId]`, qu'un `push` ne touche pas — il ne serait
    // jamais invalidé et aucun watch ne se déclencherait dessus (piège historique).
    // `at(-1)` fonctionne parce qu'il lit `length` + un index.
    const lastRoomSignal = computed(() => {
        return peerStore.getLastRoomSignal(contextId)
    })

    // CONNECTION EVENTS
   const connectionEvents = reactive({
        onConnectionOpen: {
            callback: () => {},
            isActive: false,
        },
        onConnectionClose: {
            callback: () => {},
            isActive: false,
        },
        onConnectionError: {
            callback: () => {},
            isActive: false,
        },
        onDataReceived: {
            callback: () => {},
            isActive: false,
        },
        onStreamReceived: {
            callback: () => {},
            isActive: false,
        }
   })

    // COMPUTED (read-only projections)
    const computedState = {
        currentType: computed(() => session.currentType),
        currentRoom: computed(() => session.currentRoom),
        onAirRoom: computed(() => session.onAirRoom),
        currentCallRoomId: computed(() => session.currentCallRoomId),
        currentCallUsers: computed(() => session.currentCallUsers),

        callInprogress: callMachine.callInprogress,
        callStatus: computed(() => callMachine.callState.value),

        // Garde de teardown : exposé en lecture seule (seuls beginShutdown/endShutdown écrivent)
        isShuttingDown: computed(() => lifecycle.shutdownCount > 0),

        remotePeers: computed(() => connection.remotePeers),
        // Exposé parce que deux gardes d'admission en dépendent : sans lui, un refus
        // légitime et un refus « je ne savais pas encore » sont indiscernables depuis
        // l'extérieur — c'est ce qui a coûté un aller-retour de diagnostic complet.
        presenceSynced: computed(() => connection.presenceSynced),

        topology: computed(() => session.topology),
        hubSlug: computed(() => session.hubSlug),
        isHub: computed(() => session.isHub),
        // Les deux moitiés du prédicat, dites séparément — le hub peut être moi, et
        // `remotePeers` ne me contient jamais. C'est le seul endroit du module qui ait
        // besoin de la composition COMPLÈTE ; l'écrire ici en deux termes évite de
        // maintenir une seconde liste (moi rajouté) que plus personne d'autre ne lit.
        isHubConnected: computed(() => {
            if (!session.hubSlug) return false
            return session.hubSlug === meStore.getMe?.slug
                || connection.remotePeers.includes(session.hubSlug)
        }),

        currentStream: computed(() => media.currentStream),
        screenStream: computed(() => media.screenStream),
        remoteStreams: computed(() => Array.from(media.remoteStreamsMap.values()).filter(e => e.remoteType !== 'screen')),
        remoteScreens: computed(() => Array.from(media.remoteStreamsMap.values()).filter(e => e.remoteType === 'screen')),
        // Pairs qui ont annoncé un flux (ou dont un appel est entré) — consommé par
        // l'UI d'attente (useAwaitedStreams) et rien d'autre.
        announcedStreamPeers: computed(() => Array.from(media.announcedStreamsMap.keys())),
        isStreaming: computed(() => media.isStreaming),
        isCapturing: computed(() => media.isCapturing),
        // « Un flux de moi est en route », PAR PAIR et non par type : du point de vue du
        // récepteur, une vignette d'attente ne se décline pas en webcam/écran.
        //
        // Posé sur le contexte parce que DEUX couches l'annoncent — useBroadcastPresence
        // sur le data channel, usePeerCore sur les deux routes de peerId — et qu'un
        // prédicat recopié dans les deux finirait par diverger.
        isBroadcasting: computed(() => !!(media.isStreaming || media.isCapturing)),
        isAudioStream: computed(() => media.isAudioStream),

        isMuted: computed(() => ui.streamStates.isMuted),
        isVideoEnabled: computed(() => ui.streamStates.isVideoEnabled),
        streamStates: computed(() => ui.streamStates),

        mySlug: computed(() => meStore.getMe?.slug),
        myName: computed(() => meStore.getMe?.name),
        localPeerId: computed(() => peerStore.lastLocalPeerId),
    }

    // HELPERS (fonctions utilitaires, actions synchrones)

    // Timeout par défaut configurable au niveau de l'instance via `options.meReadyTimeoutMs`,
    // sinon valeur partagée `ME_READY_TIMEOUT_MS` du fichier de config.
    const _defaultMeReadyTimeoutMs = Number.isFinite(options?.meReadyTimeoutMs)
        ? options.meReadyTimeoutMs
        : ME_READY_TIMEOUT_MS

    /**
     * Les attentes EN VOL de ce contexte — celles de `waitForMeReady` et de
     * `waitForPresenceSync`, qui partagent le même idiome.
     *
     * ⚠️ Leurs `effectScope` sont DÉTACHÉS : sans ce registre, une attente survit à la
     * destruction de son contexte jusqu'à sa propre alarme (15 s / 5 s), et les
     * continuations reprennent derrière elle sur un contexte mort. Quatre consommateurs de
     * production sont concernés — `useConnectionPool`, `usePeerConnections` et les DEUX de
     * `useStreamManager` —, et ils ne sont pas inertes : `handleStreamReceived` repeuple
     * `remoteStreamsMap` que `destroy()` vient de vider et peut créer un player DOM pour un
     * contexte mort, `handleStreamRemoved` appelle `handleRemoteDeparture`, qui avale ses
     * exceptions.
     *
     * `destroy()` les résout donc à `false`, ce qui les fait toutes sortir par le
     * `if (!ready) return` que chacune écrit DÉJÀ, et qui est déjà testé : on éteint la
     * source au lieu d'ajouter un garde par consommateur. C'est aussi ce qui rend le garde
     * de `getRoomUsersDiff` un SECOND mécanisme et pas un doublon — il tient encore si un
     * jour une attente d'une autre nature s'intercale.
     */
    const _pendingWaiters = new Set()

    // Attendre que le peer soit prêt (ex: meStore.getMe.slug disponible) avant de faire des actions dépendantes du peerId
    // Utilise un watchEffect réactif (effectScope détaché) plutôt qu'un polling setTimeout.
    // Se résout dès que meStore.getMe.slug ET peerStore.lastLocalPeerId sont disponibles.
    const waitForMeReady = (timeoutMs = _defaultMeReadyTimeoutMs) => {
        return new Promise((resolve) => {
            let resolved = false
            let timeoutId = null

            // Scope détaché : pas lié au cycle de vie d'un composant, nettoyé manuellement.
            // Permet d'appeler watchEffect hors contexte setup() sans warning Vue.
            const scope = effectScope(true)

            const _resolve = (value) => {
                if (resolved) return
                resolved = true
                _pendingWaiters.delete(_resolve)
                clearTimeout(timeoutId)
                scope.stop()
                resolve(value)
            }

            // ⚠️ Inscrit AVANT `scope.run()` : le watchEffect s'exécute immédiatement, donc
            // `_resolve(true)` peut partir de façon synchrone et se désinscrire aussitôt.
            // Inscrit après, une attente déjà résolue resterait dans le registre à vie.
            _pendingWaiters.add(_resolve)

            // Timeout de sécurité — une seule alarme, pas de boucle de polling.
            // ⚠️ Armé AVANT scope.run() : le watchEffect s'exécute immédiatement, donc
            // _resolve(true) peut partir de façon synchrone. Si le setTimeout était
            // déclaré après, ce clearTimeout porterait sur `null` → le timer survivrait
            // et cracherait un faux « a expiré » 15 s plus tard, sur un contexte sain.
            timeoutId = setTimeout(() => {
                console.warn('waitForMeReady a expiré après', timeoutMs, 'ms')
                _resolve(false)
            }, timeoutMs)

            scope.run(() => {
                watchEffect(() => {
                    const slug = meStore.getMe?.slug
                    // peerStore.lastLocalPeerId est réactif (Pinia) et mis à jour par l'événement
                    // 'open' de PeerJS — contrairement à localPeer.id qui est markRaw.
                    const peerId = peerStore.lastLocalPeerId
                    if (slug && peerId) {
                        // On initialise le contexte dès que l'identité locale est réellement prête.
                        session.isHub = (slug === session.hubSlug)
                        _resolve(true)
                    }
                })
            })
        })
    }

    // Attente de la PREMIÈRE synchronisation de présence de ce contexte.
    //
    // Même idiome que waitForMeReady (effectScope détaché + watchEffect, pas de polling),
    // mais MÉMOÏSÉE : une seule promesse et un seul timer par contexte, pour la vie du
    // contexte. C'est ce qui la rend sûre à appeler depuis un garde d'admission — un
    // contexte sans canal de présence (`data-app` de Notifications.vue, qui n'ouvre que
    // des appels directs) paierait sinon le timeout à chaque connexion refusée, et un
    // flot de connexions forgées y accumulerait autant de promesses en vol.
    //
    // Résout `true` dès que la présence est connue, `false` au timeout — et reste
    // résolue : après un échec, les gardes concluent immédiatement.
    let _presenceSyncPromise = null

    const waitForPresenceSync = (timeoutMs = PRESENCE_SYNC_TIMEOUT_MS) => {
        if (connection.presenceSynced) return Promise.resolve(true)
        if (_presenceSyncPromise) return _presenceSyncPromise

        _presenceSyncPromise = new Promise((resolve) => {
            let resolved = false
            let timeoutId = null
            const scope = effectScope(true)

            const _resolve = (value) => {
                if (resolved) return
                resolved = true
                _pendingWaiters.delete(_resolve)
                clearTimeout(timeoutId)
                scope.stop()
                resolve(value)
            }

            // Même registre et même raison que `waitForMeReady` : cette attente-ci garde un
            // garde d'admission en suspens (`_admitIncoming` l'attend avant de REFUSER).
            // Sur un contexte détruit, la résoudre à `false` fait conclure le refus tout de
            // suite au lieu de payer les 5 s. La mémoïsation reste juste : un contexte mort
            // ne rendra plus jamais « présence connue ».
            _pendingWaiters.add(_resolve)

            // Armé AVANT scope.run() : le watchEffect s'exécute immédiatement et peut
            // résoudre de façon synchrone (même piège que waitForMeReady — un timer
            // déclaré après survivrait à son clearTimeout).
            timeoutId = setTimeout(() => _resolve(false), timeoutMs)

            scope.run(() => {
                watchEffect(() => {
                    if (connection.presenceSynced) _resolve(true)
                })
            })
        })

        return _presenceSyncPromise
    }

    // WeakSet interne pour suivre les connexions déjà bindées et éviter les doublon s de listeners (idempotence)
    // sans polluer les objets tiers PeerJS avec des flags personnalisés.
    const _boundConnections = new WeakSet()

    const setUpConnectionListeners = (conn) => {
        if (!conn || typeof conn.on !== 'function') {
            return () => {}
        }

        // Evite de binder plusieurs fois les mêmes handlers sur la même instance
        if (_boundConnections.has(conn)) {
            return () => {}
        }
        _boundConnections.add(conn)

        // Variables de closure
        // collés sur l'objet tiers PeerJS
        let closeHandled = false
        let customCloseEmitted = false

        // Déclaré ici (let) pour être accessible dans handleClose avant l'assignation finale
        let cleanup = () => {}

        //------------------
        // core events — handlers nommés pour pouvoir les passer à conn.off()
        //------------------
        const handleOpen = () => {
            // `conn.metadata.type` est contrôlé par le pair distant : on n'expose que la
            // valeur si elle appartient à VALID_CONNECTION_TYPES (cf. sanitizeMetadataType),
            // sinon "unknown". Évite d'imprimer un type forgé dans la trace.
            console.trace("connection " + (sanitizeMetadataType(conn.metadata?.type) || "unknown") + " ouverte dans Context", conn.metadata)
        }

        const handleClose = () => {
            // Idempotence: un close déjà traité ne doit pas retraiter le cleanup
            if (closeHandled) {
                return
            }
            closeHandled = true

            // Sanitization du type (contrôlé par le pair distant) avant utilisation comme
            // clé de store et dans les logs — un type forgé serait sinon utilisé tel quel
            // par peerStore.removePeerConnectionInstance.
            const type = sanitizeMetadataType(conn.metadata?.type)

            console.log("connection " + (type || "unknown") + " fermée dans Context", conn.metadata)

            const room = conn.metadata?.room
            const storedSlug = conn.metadata?.slug

            // Détection robuste du peer distant (évite de supprimer mon propre slug)
            const mySlug = meStore.getMe?.slug || null
            const fromSlug = conn.metadata?.from || null
            const slugMeta = conn.metadata?.slug || null

            let remoteSlug = null
            if (fromSlug && fromSlug !== mySlug) {
                remoteSlug = fromSlug
            } else if (slugMeta && slugMeta !== mySlug) {
                remoteSlug = slugMeta
            }

            // Retirer uniquement cette instance (ne pas fermer en cascade ici)
            peerStore.removePeerConnectionInstance(
                room,
                storedSlug,
                type,
                conn
            )

            // Supprime le remotePeerId seulement si l'utilisateur n'est plus en room.
            // La condition n'est PAS relue ici : `removeRemotePeerId` porte le prédicat
            // de présence, et il le porte sur TOUTES les rooms de l'onglet — pas
            // seulement la mienne. Le dupliquer localement le rendrait à la fois
            // redondant et plus faible (un pair encore présent dans un autre contexte
            // serait oublié par celui-ci).
            if (remoteSlug) {
                peerStore.removeRemotePeerId(remoteSlug)
            }

            // Auto-cleanup : retire tous les listeners dès que la connexion est fermée
            // (cleanup est déjà assigné au moment où ce handler s'exécute car c'est async)
            cleanup()

            // En DERNIER : publier la perte, une fois l'état du store déjà purgé — le
            // lecteur (useConnectionPool) interroge `isConnectionEstablished` et le
            // mapping, qui doivent donc décrire l'après-fermeture.
            //
            // ⚠️ Le garde est lu ICI, de façon SYNCHRONE, et pas dans le watcher. Un
            // arrêt volontaire (`stopCallWithPeers`) pose `beginShutdown()`, ferme les
            // connexions, puis relâche dans un `finally` ASYNCHRONE : lu une microtâche
            // plus tard, `isShuttingDown` peut être déjà retombé, et un raccroché serait
            // re-composé. À l'instant de la fermeture, il ne peut pas mentir.
            if (remoteSlug && lifecycle.shutdownCount === 0) {
                connectionLostSignal.value = remoteSlug
            }
        }

        //------------------
        // custom events — handlers nommés pour pouvoir les passer à conn.off()
        //------------------
        // Wrapper nommé (et non le callback nu) pour passer la connexion : `conn.on('open')`
        // n'émet aucun argument, alors que les consommateurs en attendent un
        // (`onConnectionOpen: (conn) => …`, cf. Exemples/Home.vue) — et l'annonce de
        // diffusion en a besoin pour savoir SUR QUELLE connexion émettre.
        const handleCustomOpen = (connectionEvents?.onConnectionOpen?.isActive)
            ? () => connectionEvents.onConnectionOpen.callback(conn)
            : null

        // Garde de taille en réception (défense-en-profondeur anti-DoS pair-à-pair) :
        // le contrôle côté émission (sendData mesh / forwardStarMessage) est
        // contournable par un pair malveillant qui retire le check client. On
        // applique donc la même limite MAX_PAYLOAD_BYTES sur chaque frame entrante
        // AVANT de la passer au callback métier ; tout payload trop volumineux ou
        // non mesurable est abandonné silencieusement (le pair n'est pas déconnecté).
        // Note : en topologie star, une enveloppe de routage ajoute un overhead de
        // quelques octets au payload — négligeable face au plafond de 64 Ko.
        const handleData = (connectionEvents?.onDataReceived?.isActive)
            ? (data) => {
                if (!isPayloadWithinLimit(data, '[Recv]')) return
                connectionEvents.onDataReceived.callback(data, conn, conn.metadata)
            }
            : null

        // Wrapper nommé nécessaire pour capturer la référence et pouvoir faire conn.off()
        const handleStream = (connectionEvents?.onStreamReceived?.isActive)
            ? (stream) => connectionEvents.onStreamReceived.callback(stream, conn, conn.metadata)
            : null

        const handleCustomClose = (connectionEvents?.onConnectionClose?.isActive)
            ? () => {
                // Evite callback close metier en double
                if (customCloseEmitted) {
                    return
                }
                customCloseEmitted = true

                const closeCallback = connectionEvents?.onConnectionClose?.callback
                if (typeof closeCallback === "function") {
                    closeCallback(conn)
                }
            }
            : null

        const handleError = (connectionEvents?.onConnectionError?.isActive)
            ? connectionEvents.onConnectionError.callback
            : null

        //------------------
        // Enregistrement
        //------------------
        conn.on("open", handleOpen)
        conn.on("close", handleClose)

        if (handleCustomOpen) conn.on("open", handleCustomOpen)
        if (handleData)       conn.on("data", handleData)
        if (handleStream)     conn.on("stream", handleStream)
        if (handleCustomClose) conn.on("close", handleCustomClose)
        if (handleError)      conn.on("error", handleError)

        //------------------
        // Cleanup (retourné pour désinscription explicite anticipée)
        //------------------
        // Assignation du let déclaré en haut du scope (accessible dans handleClose)
        cleanup = () => {
            if (!_boundConnections.has(conn)) return
            _boundConnections.delete(conn)

            conn.off("open", handleOpen)
            conn.off("close", handleClose)

            if (handleCustomOpen)  conn.off("open", handleCustomOpen)
            if (handleData)        conn.off("data", handleData)
            if (handleStream)      conn.off("stream", handleStream)
            if (handleCustomClose) conn.off("close", handleCustomClose)
            if (handleError)       conn.off("error", handleError)
        }

        return cleanup
    }

    const storeConnectionEventCallbacks = (callbacks) => {
        try {
            if (!callbacks || typeof callbacks !== "object") {
                return
            }

            Object.keys(callbacks).forEach((callbackKey) => {
                const eventEntry = connectionEvents[callbackKey]
                const candidate = callbacks[callbackKey]

                // Ignore les cles inconnues et les callbacks non-fonction
                if (!eventEntry || typeof candidate !== "function") {
                    return
                }

                if (!eventEntry.isActive) {
                    eventEntry.callback = candidate
                    eventEntry.isActive = true
                }
            })
        } catch (e) {
            console.log("Erreur lors de l'initialisation des callbacks de connexion", e)
        }
    }

    const setCurrentCallUsers = (users = []) => {
        session.currentCallUsers = Array.isArray(users) ? users : []
        return session.currentCallUsers
    }

    const addCurrentCallUser = (userSlug = null, type = 'visio') => {
        if (!userSlug) {
            return session.currentCallUsers
        }

        const exists = session.currentCallUsers.some(
            (u) => u.userSlug === userSlug && u.type === type
        )

        if (!exists) {
            session.currentCallUsers = [...session.currentCallUsers, { userSlug, type }]
        }

        return session.currentCallUsers
    }

    const removeCurrentCallUser = (userSlug) => {
        if (!userSlug) {
            return session.currentCallUsers
        }

        session.currentCallUsers = session.currentCallUsers.filter((u) => u.userSlug !== userSlug)

        return session.currentCallUsers
    }

    const clearCurrentCallUsers = () => {
        session.currentCallUsers = []
        return session.currentCallUsers
    }

    /**
     * Accesseurs de `media.announcedStreamsMap` — « un flux de ce pair est en route ».
     *
     * Accesseurs plutôt qu'écriture directe, pour la même raison que
     * beginShutdown/endShutdown : QUATRE chemins y écrivent (annonce data channel, appel
     * entrant, état embarqué sur les deux routes de peerId, whisper sur le canal de
     * présence), la validation du slug doit donc tenir à un seul endroit.
     * `source` n'est que de la traçabilité (debug) : la présence de la clé est le fait.
     *
     * @param {string} userSlug
     * @param {'signal'|'call'|'peer-id'|'presence'} source
     */
    const markAnnouncedStream = (userSlug, source = 'signal') => {
        if (!isValidSlug(userSlug)) return false
        if (userSlug === meStore.getMe?.slug) return false

        media.announcedStreamsMap.set(userSlug, { source, at: Date.now() })
        return true
    }

    const clearAnnouncedStream = (userSlug) => {
        if (!userSlug) return false
        return media.announcedStreamsMap.delete(userSlug)
    }

    /**
     * Accesseurs de `session.authorizedCallPeers` — « un appel direct avec ce pair a été
     * autorisé ». Allowlist du garde d'autorisation SORTANTE (utils/isAuthorizedPeer.js),
     * qui admet un pair hors room à cette seule condition.
     *
     * ⚠️ Registre dédié, et surtout PAS `session.currentCallUsers` : ce dernier est un
     * état d'affichage (qui voir, qui raccrocher), muté par l'UI et sans invariant à
     * protéger. `_isAuthorizedIncomingPeer` a déjà rejeté cet usage pour la même raison —
     * réutiliser un état applicatif comme allowlist couple politique de sécurité et
     * affichage, et une évolution d'UI devient alors une faille.
     *
     * Propriétaire unique : `useCallManager`, seul écrivain (marque à l'acceptation et à
     * l'ouverture, purge au départ du pair et au reset). Jamais d'écriture directe —
     * même contrat que markAnnouncedStream, pour que la validation tienne à un endroit.
     *
     * @param {string} userSlug
     */
    const markAuthorizedCallPeer = (userSlug) => {
        if (!isValidSlug(userSlug)) return false
        if (userSlug === meStore.getMe?.slug) return false

        session.authorizedCallPeers.set(userSlug, { at: Date.now() })
        return true
    }

    const isAuthorizedCallPeer = (userSlug) => {
        if (!userSlug) return false
        return session.authorizedCallPeers.has(userSlug)
    }

    const clearAuthorizedCallPeer = (userSlug) => {
        if (!userSlug) return false
        return session.authorizedCallPeers.delete(userSlug)
    }

    // Purge totale — le pendant de clearCurrentCallUsers pour la fin d'appel
    // (`useCallManager.resetCallState`) : plus aucun appel en cours, donc plus aucune
    // autorisation à conserver.
    const clearAllAuthorizedCallPeers = () => {
        session.authorizedCallPeers.clear()
    }

    /**
     * Lifecycle hooks
     */
    onBeforeMount(() => {
        // On crée la "room de signalisation" dans le peerStore 
        // dès que le contexte est initialisé.
        peerStore.createSignalQueueRoom(contextId)
    })

    // Nettoyage complet du contexte à la destruction du composant propriétaire
    const destroy = () => {
        // EN PREMIER : ce contexte n'attend plus rien. Les attentes en vol sont des
        // `effectScope` détachés que rien d'autre n'annule ; les laisser pendantes fait
        // reprendre leurs quatre consommateurs sur un contexte mort, jusqu'à 15 s plus tard
        // (cf. `_pendingWaiters`). Résoudre à `false` les fait sortir par le
        // `if (!ready) return` que chacun écrit déjà.
        //
        // Avant les purges, et pas après : les continuations sont des microtâches, donc
        // elles reprennent de toute façon une fois ce `destroy()` terminé — mais l'ordre
        // écrit ici dit l'intention, et il évite d'armer une attente pendant le teardown.
        ;[..._pendingWaiters].forEach((abort) => abort(false))
        _pendingWaiters.clear()

        // Supprime la signal queue room créée dans onBeforeMount
        //
        // ⚠️ Pas de garde de propriété ici, contrairement à `clearRoomMembers` juste en
        // dessous, et c'est mesuré, pas oublié : `clearSignalQueueRoom` n'est pas un verbe
        // de témoignage — il a deux autres appelants de production, EN PLEINE SESSION
        // (`usePeerConnections`), pour qui vider sa propre file est normal. Et la collision
        // d'homonymes y coûte au plus un signal tamponné : `dispatchSignal` recrée la file
        // si elle manque, et `signalSeq` n'est délibérément pas supprimé, donc aucun rewind.
        peerStore.clearSignalQueueRoom(contextId)

        // Ce contexte ne témoigne plus de la présence de personne. Sans ce retrait, un
        // provider démonté continuerait de « voir » ses pairs dans l'index partagé et
        // empêcherait à jamais l'oubli de leur peerId (cf. peerStore.removeRemotePeerId).
        //
        // ⚠️ On se présente : le contextId est `type-room` et le registre est
        // last-write-wins, donc deux homonymes se chevauchent à chaque remontage. Sans
        // cette identité, le mourant emporterait l'allowlist du vivant — qui refuserait
        // alors toute connexion entrante du chemin présence, en silence.
        peerStore.clearRoomMembers(contextId, context)

        // Libère les références aux streams distants
        media.remoteStreamsMap.clear()
        media.announcedStreamsMap.clear()
        media.currentStream = null

        // Réinitialise les états de session
        session.currentCallUsers = []
        // Le registre d'autorisation d'appel meurt avec le contexte : une autorisation
        // survivante rouvrirait le garde sortant sur un pair d'une session précédente.
        session.authorizedCallPeers.clear()
        media.isStreaming = false
        media.isCapturing = false

        // Remet la machine d'état d'appel à IDLE et vide closingUsers
        callMachine.reset()

        // Le fait de connaître la composition retombe ici ; la composition elle-même est
        // déjà partie plus haut, avec `clearRoomMembers` — un contexte détruit ne sait plus
        // qui est membre, il ne sait pas « personne ». Les deux moitiés vivaient côte à côte
        // tant que la liste était un champ de `connection` ; depuis qu'elle est dans le
        // store, elles se rabaissent à vingt lignes d'écart, et rien entre les deux ne lit
        // la composition (vérifié).
        connection.presenceSynced = false
        // Même raison, et une de plus : l'annuaire est ce qui rend un `user_id` de whisper
        // traduisible. Le laisser survivre à un contexte détruit laisserait attribuable
        // une annonce arrivée après la mort du contexte.
        connection.slugByUserId.clear()

        // ⚠️ lifecycle.shutdownCount n'est PAS réinitialisé : le garde doit rester
        // actif après le teardown terminal pour bloquer tout retry résiduel.
    }

    onUnmounted(() => {
        destroy()
    })

    // Signal réactif : communication inverse usePeerTransport → usePeerOrchestrator
    // usePeerTransport écrit le slug du peer indisponible ici ;
    // usePeerOrchestrator l'observe via watch() et déclenche la recovery.
    // Remplace l'ancienne mutation implicite de hooks.onPeerUnavailable.
    const peerUnavailableSignal = ref(null)

    // Signal réactif : communication inverse usePeerCore → UI (Notifications.vue).
    // usePeerCore y écrit `{ userSlug, type }` quand le moteur de retry d'invitation
    // épuise ses tentatives — c'est-à-dire quand le destinataire n'a aucun onglet ouvert
    // et qu'aucun `.ResponseToAuthorizationPeer` n'arrivera jamais. Un signal, et non un
    // callback vers `stopCallWithPeers` : usePeerCore est la couche la plus basse, elle ne
    // connaît ni la FSM d'appel ni l'UI. Le consommateur le remet à null.
    const inviteAbandonedSignal = ref(null)

    // Signal réactif : communication inverse createPeerContext → useConnectionPool.
    // `handleClose` y écrit le slug du pair dont une connexion vient de tomber ; le pool
    // l'observe et décide, seul, s'il y a lieu de re-composer.
    //
    // ⚠️ Une PERTE n'est pas un DÉPART, et c'est pourquoi ce signal existe plutôt qu'un
    // greffon sur `handleRemoteDeparture` : le wrap de l'orchestrateur ne route vers la
    // séquence de départ que les fermetures ENTRANTES d'un contexte `stream`. Or ce qui
    // tombe chez un diffuseur quand son pair recharge, c'est sa connexion SORTANTE —
    // qu'aucun chemin n'observait, tous types confondus. `handleClose` est le seul point
    // d'entrée universel d'une fermeture.
    const connectionLostSignal = ref(null)

    // ⚠️ Liaison NOMMÉE, pas un littéral rendu directement : c'est cet objet-ci qui est
    // inscrit au `contextRegistry` (via `setLocalPeer`), donc c'est lui que `destroy()`
    // doit présenter pour prouver que la composition qu'il retire est bien la sienne.
    // Sans identité à présenter, le garde de `clearRoomMembers` n'aurait rien à comparer.
    const context = {
        contextId,
        lastRoomSignal,

        // infra
        peerStore,
        meStore,
        serverStore,
        AjaxService,
        eventBus: _safeEventBus,

        // state (grouped)
        session,
        media,
        ui,
        connection,
        lifecycle,
        connectionEvents,

        // machine d'état d'appel (remplace callInprogress / isStoppingCall / closingUsers)
        callMachine,

        // computed
        ...computedState,

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

        // signal réactif (usePeerTransport → usePeerOrchestrator)
        peerUnavailableSignal,

        // signal réactif (usePeerCore → UI)
        inviteAbandonedSignal,

        // signal réactif (createPeerContext → useConnectionPool)
        connectionLostSignal,

        // destruction explicite (cleanup manuel si nécessaire hors lifecycle)
        destroy,
    }

    return context
}