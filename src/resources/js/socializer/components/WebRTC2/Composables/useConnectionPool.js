/**
 * 🔗 useConnectionPool (Connection Layer)
 *
 *  établissement et maintien des connexions pair-à-pair d'une room
 *
 * 👉 gère :
 * - le moteur de retry des connexions (instance dédiée de usePeerRetry)
 * - la décision « demander un peerId » vs « ouvrir la connexion »
 * - la recovery sur peer indisponible (watch de ctx.peerUnavailableSignal)
 * - la re-composition sur perte de connexion (watch de ctx.connectionLostSignal)
 * - la synchronisation room → connexions (diff des users, fan-out mesh / star)
 *
 * 👉 utilise (par injection, jamais par import) :
 * - usePeerCore (signalisation), usePeerConnections (connexions PeerJS)
 *
 * 👉 ne connaît PAS :
 * - la logique d'appel (invite / accept / raccroché) → useCallManager
 * - les streams et le DOM → usePeerMedia
 * - l'orchestrateur : aucune couche supérieure ne lui est injectée
 *
 * 👉 rôle :
 * - socle de connexion sur lequel s'appuient les couches appels et streams
 */

import { ref, watch, onUnmounted } from 'vue'
import { usePeerRetry } from '~socializer/components/WebRTC2/Composables/utils/usePeerRetry.js'
import { isValidSlug } from '~socializer/components/WebRTC2/Composables/utils/validators.js'
import { isAuthorizedPeer } from '~socializer/components/WebRTC2/Composables/utils/isAuthorizedPeer.js'
import { SIGNALING_STALE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

export function useConnectionPool(ctx, { core, connections }) {

    const syncUsersConnectionsLock = ref(false)

    // La dernière composition reçue pendant qu'un tour de synchronisation était en vol, et
    // les appelants qui attendent qu'elle soit traitée. Internes : rien de tout cela n'est
    // exposé — la surface de debug ne grossit pas, `syncUsersConnectionsLock` continue de
    // dire « un tour est en cours » et rien d'autre.
    let _pendingUsers = null
    const _syncWaiters = []

    // Moteur de retry des connexions, propriété du pool.
    // (usePeerCore garde le sien, dédié aux invitations d'appel.)
    const retryManager = usePeerRetry(ctx)

    /**
     * Le flux exigé par ce type de connexion est-il réellement émettable ?
     *
     * Réplique la précondition de `usePeerConnections.connectToPeer`, qui pour `stream`
     * et `screen` sort par un `return true` **sans rien ouvrir** quand le flux local
     * n'est pas (encore) valide. Vu du moteur de retry, ce `true` est ambigu : il dit
     * « pas d'erreur », pas « connexion établie ». Ce prédicat lève l'ambiguïté sans
     * changer le contrat de connectToPeer, en distinguant « rien à envoyer, abandonner »
     * de « pas encore prêt, réessayer ».
     *
     * @param {string} type
     * @returns {boolean}
     */
    const _canEmitStreamFor = (type) => {
        // Un data channel n'a aucun flux à porter : toujours émettable.
        if (type === 'data') return true

        const stream = type === 'screen' ? ctx.media.screenStream : ctx.media.currentStream
        return stream instanceof MediaStream
            && stream.getTracks().some(track => track.readyState === 'live')
    }

    /**
     * La demande de peerId émise par CE contexte pour ce type, si elle est encore en vol.
     *
     * ⚠️ `room` doit être celle qu'utilise `usePeerCore.requestRemotePeerConnection` à
     * l'écriture (`session.onAirRoom`), pas la room de connexion (`currentCallRoomId ||
     * currentRoom`) : la clé du store est un contrat entre l'émetteur et le lecteur, et
     * une lecture sur une autre room ne trouverait jamais rien — le contexte se croirait
     * libre de redemander en boucle.
     *
     * L'exactitude de cette lecture est ce qui isole les contextes entre eux : lire sur
     * le slug seul faisait qu'un provider voyait la demande d'un autre et n'émettait
     * jamais la sienne (symptôme : le contexte `stream` reste muet, l'arrivant ne voit
     * aucun flux tant que le moteur de retry n'a pas rattrapé, 12 s plus tard).
     *
     * @param {string} userSlug
     * @param {string} type
     * @returns {Object|null}
     */
    const _myPendingRequest = (userSlug, type) => {
        return ctx.peerStore.getWaitingRemotePeerId(userSlug, ctx.session.onAirRoom, type)
    }

    /**
     * LOGIQUE DE TENTATIVE (Callback pour le RetryManager)
     * Détermine si on doit continuer à essayer de se connecter à un user.
     */
    const _handleConnectionAttempt = async (userSlug) => {
        // 🛑 Ne relance RIEN si on est en train d'arrêter
        if (ctx.isShuttingDown.value) return true

        const room = ctx.session.currentCallRoomId || ctx.currentRoom.value

        // ⚠️ DEUX prédicats, et surtout pas un seul — ils répondent à deux questions
        // opposées, que ce moteur a longtemps confondues :
        //
        //   `hasOpenConnection`      « dois-je m'abstenir d'en ouvrir une seconde ? »
        //                            → optimiste : une connexion en vol compte.
        //   `isConnectionEstablished` « ai-je fini ? »
        //                            → strict : seul un transport établi compte.
        //
        // Conclure au succès sur le prédicat optimiste annulait le retry une seconde
        // après `peer.call()`, alors que l'appel pouvait n'avoir jamais été répondu (le
        // RTCPeerConnection reste alors `connecting` à vie). Toute défaillance
        // d'admission devenait ainsi définitive, sans erreur console.
        const mainTypeOpen = connections.hasOpenConnection(userSlug, null, ctx.currentType.value)
        const screenOpen = !ctx.media.isCapturing
            || connections.hasOpenConnection(userSlug, null, 'screen')

        const isEstablished = () => (
            connections.isConnectionEstablished(userSlug, null, ctx.currentType.value)
            && (!ctx.media.isCapturing
                || connections.isConnectionEstablished(userSlug, null, 'screen'))
        )

        // 1. Succès ultime : la connexion attendue est réellement ÉTABLIE.
        if (isEstablished()) return true

        // ⚠️ Le peerId SOUS BAIL, jamais `getRemotePeerId` : passé
        // REMOTE_PEER_ID_LEASE_MS sans preuve fraîche, l'entrée du store ne vaut plus
        // qu'on compose dessus — un pair qui a rechargé sa page a un peerId neuf, et rien
        // ici ne l'a appris. Le tour tombe alors dans la branche 2 (redemander) ou 4
        // (relancer la demande en vol), et la réponse ré-estampille l'entrée.
        const remotePeerId = ctx.peerStore.getDialableRemotePeerId(userSlug)
        const waiting = _myPendingRequest(userSlug, ctx.currentType.value)

        // 2. Ni peerId, ni demande en vol. DEUX situations opposées se ressemblent ici, et
        //    les confondre coûtait le symptôme le plus cher du module :
        //
        //      • le pair est réellement parti      → il faut arrêter
        //      • ma demande n'a jamais pu partir   → il faut surtout NE PAS arrêter
        //
        //    Le second n'est pas un cas limite, c'est le cas nominal : `requestOrConnectPeer`
        //    lance `requestRemotePeerConnection` SANS l'attendre, puis arme ce moteur à
        //    1 s (usePeerRetry : 1000·2^0 + jitter). Or le drapeau `waiting` n'est écrit
        //    qu'APRÈS l'aller-retour HTTP — et pas écrit du tout quand la demande sort par
        //    l'un de ses gardes : plafond de cadence (3 par 10 s et par `slug|room|type`,
        //    que la boucle de recovery est justement faite pour atteindre), peerId local
        //    pas encore prêt, ou POST en erreur. Ce tour-ci ne voyait alors ni ID ni
        //    intention et concluait « parti » — et `return true` ne suspend pas le moteur,
        //    il l'éteint : usePeerRetry ne replanifie rien. Plus personne ne redemandait
        //    jamais le peerId de ce pair.
        //
        //    Symptôme exact, et il est aléatoire parce qu'il ne dépend que de la latence
        //    d'un POST : A diffuse, B arrive, A logue UN « Could not connect to peer
        //    <uuid> » puis se tait définitivement, et B ne voit même pas de spinner —
        //    aucun contact ne lui est jamais parvenu, donc il n'a rien à annoncer.
        //
        //    Ce qui départage « parti » de « pas encore demandé » n'est pas l'absence d'un
        //    drapeau de bookkeeping : c'est la PRÉSENCE. Même prédicat que les deux gardes
        //    d'autorisation du contexte (utils/isAuthorizedPeer.js), donc même définition
        //    de « ce pair me concerne encore ».
        if (!remotePeerId && !waiting) {
            if (!isAuthorizedPeer(userSlug, ctx)) return true

            // Encore présent : on (re)tente la demande et on reste en vie. Borné par
            // MAX_RETRY_ATTEMPTS et son backoff — au pire ~55 s d'insistance avant
            // l'abandon explicite du moteur, jamais une boucle.
            core.requestRemotePeerConnection(userSlug, ctx.currentType.value)
            if (ctx.media.isCapturing) {
                core.requestRemotePeerConnection(userSlug, 'screen')
            }
            return false
        }

        // 3. Si on a un ID, on tente la connexion (même si waiting a sauté)
        if (remotePeerId) {
            // ⚠️ Les deux tentatives sont INDÉPENDANTES : ne jamais sortir entre les deux.
            // Le type principal et le partage d'écran partagent la même chaîne de retry
            // (usePeerRetry._retryKey ne discrimine pas le type), donc un `return`
            // prématuré ici condamne l'autre tentative avec lui. Le cas critique est
            // l'écran : `requestRemotePeerConnection` envoie toujours `type: currentType`,
            // jamais `'screen'` — ce moteur est donc le SEUL à ouvrir la connexion d'écran
            // vers un arrivant. Un `return` avant la branche ci-dessous et le partage
            // d'écran n'atteint jamais personne (symptôme observé : « aléatoire », parce
            // que ça ne cassait que si A n'avait pas aussi un flux webcam actif).
            // On accumule donc l'état et on ne décide qu'à la fin.
            let settled = true

            if (!mainTypeOpen) {
                const connected = connections.connectToPeer({
                    userSlug,
                    peerId: remotePeerId,
                    type: ctx.currentType.value,
                    room,
                })

                // Deux raisons distinctes de différer :
                // - `connected === false` : échec réel (ex: visio sans flux prêt)
                // - `connected === true` mais rien d'ouvert : pour `stream`/`screen`,
                //   connectToPeer sort par true sans rien ouvrir quand le flux local n'est
                //   pas encore valide. Conclure ici **annulait** le retry au lieu de le
                //   différer, et la connexion n'était plus jamais rouverte une fois le flux
                //   prêt.
                if (!connected || !_canEmitStreamFor(ctx.currentType.value)) settled = false
            }

            if (ctx.media.isCapturing && !screenOpen) {
                const connected = connections.connectToPeer({
                    userSlug,
                    peerId: remotePeerId,
                    type: 'screen',
                    room,
                })

                if (!connected || !_canEmitStreamFor('screen')) settled = false
            }

            // `false` = « rien n'est encore conclu, redemander plus tard ». Quand A ne
            // partage QUE son écran, le type principal n'aura jamais de flux : le retry
            // ira donc jusqu'à MAX_RETRY_ATTEMPTS puis abandonnera avec un warn, alors que
            // la connexion d'écran est établie depuis longtemps. Borné et sans conséquence
            // fonctionnelle. Distinguer « n'aura jamais de flux » de « pas encore de flux »
            // n'est pas décidable ici — cf. l'item TODOLIST sur le type envoyé par
            // requestRemotePeerConnection.
            //
            // ⚠️ `settled` ne suffit PAS : il ne dit que « je n'ai rien laissé en erreur »,
            // pas « c'est établi ». Une connexion simplement OUVERTE — offre partie,
            // réponse jamais arrivée — passait ici et arrêtait la surveillance pour de
            // bon. On relit l'établissement APRÈS les tentatives : sur un canal data,
            // l'ouverture peut être immédiate et conclure dès ce tour ; sur un appel
            // média, elle demande un aller-retour, et le retry reste en vie d'ici là.
            return settled && isEstablished()
        }

        // 4. Signalisation stale : On ne demande l'ID que si on est toujours en attente (waiting)
        if (waiting) {
            const age = Date.now() - (waiting.createdAt ?? 0)
            if (age >= SIGNALING_STALE_MS) {
                // On redemande pour ce qui manque réellement — y compris l'écran, dont
                // c'était jusqu'ici le seul chemin d'ouverture possible.
                if (!mainTypeOpen) core.requestRemotePeerConnection(userSlug, ctx.currentType.value)
                if (ctx.media.isCapturing && !screenOpen) core.requestRemotePeerConnection(userSlug, 'screen')
            }
        }

        return false
    }

    /**
     * Tente de se connecter à un peer distant ou de demander une connexion si nécessaire.
     *
     * @param {string} userSlug - L'identifiant de l'utilisateur pour lequel la connexion est tentée.
     * @param {string|null} type - Type de connexion (défaut : type courant du contexte).
     * @param {Object} [options]
     * @param {boolean} [options.preserveRetry=false] - Ne pas réarmer une chaîne de retry
     *        déjà en vol pour ce pair. Réservé aux appelants **périodiques** (cf. plus bas).
     * @returns {void}
     */
    const requestOrConnectPeer = (userSlug, type = null, { preserveRetry = false } = {}) => {
        if (!userSlug) return
        const effectiveType = type || ctx.currentType.value
        if (connections.hasOpenConnection(userSlug, null, effectiveType)) return

        // Sous bail uniquement — cf. _handleConnectionAttempt. Le garde
        // `hasOpenConnection` ci-dessus reste AVANT cette lecture : un bail échu ne doit
        // jamais déranger une connexion en place.
        const remotePeerId = ctx.peerStore.getDialableRemotePeerId(userSlug)
        const waiting = _myPendingRequest(userSlug, effectiveType)

        if (remotePeerId) {
            connections.connectToPeer({
                userSlug,
                peerId: remotePeerId,
                type: effectiveType,
                room: ctx.session.currentCallRoomId || ctx.currentRoom.value,
            })
        } else if (!waiting) {
            // On ne demande que si on n'est pas déjà en train d'attendre.
            // ⚠️ Le type est transmis : sans lui, une demande pour 'screen' repartait
            // avec le type du contexte et la connexion d'écran n'était jamais ouverte
            // par la signalisation (seul le moteur de retry le faisait, ~1,5 s plus tard).
            core.requestRemotePeerConnection(userSlug, effectiveType)
        }

        // On lance le moteur de retry (qui surveillera l'évolution vers 'open')
        //
        // ⚠️ `preserveRetry` protège l'HORIZON D'ABANDON, et le défaut reste le réarmement.
        // `scheduleRetry(slug, 0, …)` commence par `clearRetry` : tout appelant qui relance
        // à l'attente 0 remet `attempt` à zéro, donc `MAX_RETRY_ATTEMPTS` n'est jamais
        // atteint et les ≈55 s d'horizon ne tombent jamais. C'est sans conséquence pour un
        // appelant ÉVÉNEMENTIEL — un arrivant, une recovery `peer-unavailable` : le fait est
        // neuf, il mérite une chaîne neuve. C'en est une pour un appelant PÉRIODIQUE : la
        // réconciliation de présence repasse à chaque tour, et sur une room qui brasse de la
        // présence un pair injoignable serait rappelé indéfiniment, à ~1 appel/s.
        //
        // Le garde porte sur le seul réarmement, jamais sur la composition elle-même : la
        // chaîne en vol continue de surveiller, et l'appel utile est déjà parti ci-dessus.
        if (preserveRetry && retryManager.hasPendingRetry(userSlug)) return

        retryManager.scheduleRetry(userSlug, 0, _handleConnectionAttempt)
    }

    // ── Recovery watch : peer-unavailable ──────────────────────────────────────
    // usePeerTransport écrit le slug du peer indisponible dans ctx.peerUnavailableSignal.
    // On observe ce signal ici (watch réactif) pour relancer le cycle de connexion.
    // Plus propre que la mutation implicite de hooks.onPeerUnavailable.
    // ─────────────────────────────────────────────────────────────────────────
    const unwatchPeerUnavailable = watch(ctx.peerUnavailableSignal, (userSlug) => {
        if (!userSlug) return
        if (ctx.isShuttingDown.value) return
        if (!isValidSlug(userSlug)) return
        requestOrConnectPeer(userSlug)
        // On remet le signal à null pour pouvoir détecter une prochaine émission
        // (watch ne se re-déclenche pas si la valeur ne change pas).
        ctx.peerUnavailableSignal.value = null
    })

    // ── Recovery watch : perte d'une connexion ─────────────────────────────────
    //
    // Le SECOND déclencheur de composition, à côté du tour de présence. Il ferme le cas
    // que la réconciliation borne sans le fermer : un rechargement chevauchant ne produit
    // AUCUN événement de présence (Reverb supprime `member_removed` tant qu'une autre
    // connexion tient, et `member_added` sur un déjà-abonné), donc aucun tour n'a lieu et
    // rien de fondé sur la présence ne peut faire mieux. Le fait qui change alors, c'est
    // la connexion — et `createPeerContext.handleClose` est son seul point d'entrée, pour
    // tous les types et les DEUX sens. La séquence de départ, elle, ne voit jamais une
    // fermeture sortante : le wrap de l'orchestrateur la réserve aux entrantes d'un
    // contexte `stream`.
    //
    // Réparation OPPORTUNISTE comme la réconciliation, et pour la même raison : PeerJS ne
    // ferme que sur `iceConnectionState` `failed`/`closed` et ne fait rien sur
    // `disconnected` — une connexion qui se dégrade sans tomber ne produit aucun signal.
    // ─────────────────────────────────────────────────────────────────────────
    const unwatchConnectionLost = watch(ctx.connectionLostSignal, (userSlug) => {
        // Remis à null d'entrée : chaque fermeture doit pouvoir se signaler, y compris
        // deux fermetures successives du même pair (un contexte `stream` ouvre un appel
        // média ET un canal data), et un `watch` ne se re-déclenche pas à valeur égale.
        if (!userSlug) return
        ctx.connectionLostSignal.value = null

        // Filet tardif : le garde qui tranche est celui de l'ÉCRITURE, lu de façon
        // synchrone dans `handleClose`. Ici `isShuttingDown` peut déjà être retombé.
        if (ctx.isShuttingDown.value) return

        // Pas de `isValidSlug` ici : `isAuthorizedPeer` l'applique déjà en première ligne
        // (contrairement au watcher voisin, qui ne le consulte pas et doit donc valider
        // lui-même). Un garde qu'aucune contre-épreuve ne peut faire rougir ment sur son
        // utilité.

        // ⚠️ ANTI-BOUCLE, et bien plus que ça : c'est aussi ce qui empêche de PARLER TROP
        // TÔT. Deux propriétés en un prédicat, et les deux sont load-bearing.
        //
        //   • la boucle : composer sur un peerId périmé rend `peer-unavailable` et une
        //     connexion orpheline, dont la fermeture repasserait ici — composition →
        //     orphelin → fermeture → composition. Une chaîne étant armée dès la première
        //     composition, le second tour sort ici ;
        //   • le pair pas encore revenu : un rechargement dure une seconde, pendant
        //     laquelle personne ne répond. Composer alors pose un `waiting` de
        //     SIGNALING_STALE_MS qui MUSELLE la demande suivante — y compris celle du
        //     tour de présence, quand le pair est enfin là. Mesuré : sans ce garde, le
        //     scénario voisin « A recharge sans que B voie son départ » passe au rouge.
        //     Tant qu'une chaîne veille, elle redemandera au bon rythme ; la perte
        //     n'apprend rien qu'elle ne sache.
        //
        // Le trou que ce déclencheur ferme est donc exactement le régime ÉTABLI : une
        // connexion qui vivait a éteint son moteur (`_handleConnectionAttempt` → `true`),
        // et plus personne ne veille quand elle tombe.
        if (retryManager.hasPendingRetry(userSlug)) return

        // Le discriminant « ce pair me concerne-t-il encore ? », le même que la branche 2
        // de `_handleConnectionAttempt` — appliqué EN AMONT, et c'est le point : le
        // laisser au moteur coûterait un POST, un jeton du plafond de cadence et un retry
        // armé avant d'être rattrapé un tour plus tard.
        if (!isAuthorizedPeer(userSlug, ctx)) return

        // Seul un contexte qui a réellement quelque chose à émettre re-compose. En mode
        // `stream`, c'est le diffuseur — la seule direction qui puisse rétablir le flux,
        // le récepteur n'ouvrant rien faute de flux local. Sans ce garde, chaque
        // récepteur d'une diffusion qui s'arrête armerait une chaîne de retry de ~55 s
        // incapable d'ouvrir quoi que ce soit, pour finir sur un warn d'abandon.
        // `'data'` rend toujours `true` : chat et visio ne sont pas concernés.
        if (!_canEmitStreamFor(ctx.currentType.value)) return

        // Sans `preserveRetry` : le garde ci-dessus a déjà écarté le cas où une chaîne
        // veille, donc il n'y a rien à préserver. Une perte est de toute façon un fait
        // ÉVÉNEMENTIEL, comme un arrivant ou une recovery `peer-unavailable` — l'horizon
        // d'abandon que `preserveRetry` protège ne vise que les appelants PÉRIODIQUES.
        requestOrConnectPeer(userSlug)
    })

    /**
     * UN tour de synchronisation, sans verrou : la boucle de drain de
     * `syncUsersConnections` est seule à l'appeler, et elle garantit la sérialisation.
     *
     * @param {Array} users - Liste des utilisateurs (objets avec un slug) présents dans la room.
     * @returns {Promise<void>}
     */
    const _doSyncUsersConnections = async (users) => {
        // on attend d’avoir les infos de contexte nécessaires (meStore ready) avant de faire quoi que ce soit.
        const ready = await ctx.waitForMeReady()
        if (!ready) {
            return
        }

        const { newUsers, removedUsers } = await connections.getRoomUsersDiff(users)

        // Nettoyage des peers qui ne sont plus dans la room.
        removedUsers.forEach(userSlug => {
            const activeRoom = ctx.session.currentCallRoomId || ctx.currentRoom.value
            retryManager.clearRetry(userSlug)

            // Mes demandes en vol pour ce pair (type principal ET 'screen') tombent
            // avec son départ. Scopées sur ma room : celles des autres contextes,
            // qui le voient peut-être encore, ne me regardent pas.
            ctx.peerStore.clearWaitingRemotePeerIds(userSlug, ctx.session.onAirRoom)

            ctx.peerStore.clearConnectionsRoom(activeRoom, userSlug, ctx.currentType.value)

            // Fermer aussi la connexion 'screen' si elle existe
            if (ctx.media.isCapturing) {
                ctx.peerStore.clearConnectionsRoom(activeRoom, userSlug, 'screen')
            }

            // En DERNIER : le prédicat de présence a déjà été mis à jour par
            // getRoomUsersDiff ci-dessus, donc ce verbe oubliera le peerId dès que
            // le pair aura disparu de la dernière room qui le déclarait. L'ordre
            // n'est plus déterminant (le prédicat ne dépend plus de `connections`),
            // mais l'intention se lit mieux ainsi : on purge, puis on oublie.
            ctx.peerStore.removeRemotePeerId(userSlug)
        })

        // ⚠️ La purge est au-dessus, le fan-out en dessous, et le garde passe ENTRE LES
        // DEUX : un tour qui n'a rien observé a le droit d'OUBLIER — c'est même le seul
        // tour capable de purger le dernier partant — jamais celui d'OUVRIR.
        //
        // Sans lui, le premier tour du provider (`{ immediate: true }` sur une liste de
        // présence encore vide) ferait composer au client star le slug de son hub avant
        // toute connaissance de la room : `requestOrConnectPeer` ne porte aucun garde
        // d'autorisation sur sa PREMIÈRE tentative (celui d'`isAuthorizedPeer` vit dans
        // `_handleConnectionAttempt`, donc un tour plus tard). Un POST de signalisation
        // part, un slot du plafond de cadence est consommé, et un moteur de retry s'arme
        // sur rien.
        //
        // Le garde porte sur le BLOC, pas sur la seule branche fautive : la règle est
        // « pas d'observation, pas d'émission », et elle ne doit pas dépendre du fait que
        // mesh / hub / sfu itèrent aujourd'hui `newUsers`, vide ici par construction. Le
        // jour où l'une d'elles itérera `usersInRoom` — comme le fait déjà
        // `startWebcamStream` — la protection incidente disparaîtrait sans un mot.
        //
        // ⚠️ Le prédicat porte sur `users`, l'entrée du tour, et surtout PAS sur
        // `ctx.connection.presenceSynced`, qui dirait pourtant la même chose ici. Adosser
        // TOUT l'établissement au drapeau de présence en ferait le point de défaillance
        // unique du module : un jour où il ne serait pas écrit, plus rien ne s'ouvrirait,
        // mesh compris. Ce drapeau garde les autorisations, il ne conditionne pas
        // l'établissement. Même prédicat que `presenceObserved` dans `_doGetRoomUsersDiff`,
        // sur la même entrée : les deux se lisent ensemble.
        if (users.length === 0) return

        // ── Le fan-out RÉCONCILIE, il ne diffe pas ──────────────────────────────────
        //
        // `newUsers` est une optimisation, pas une autorité : il ne nomme que les
        // TRANSITIONS que le diff a vues. Or un diff d'instantanés est aveugle à un pair
        // parti et revenu entre les deux instantanés qu'il compare — il est alors dans
        // `previousSlugs` ET `nextSlugs`, donc dans aucune des deux listes. Deux chemins de
        // production le font, et aucun n'est le « même flush Vue » qu'on soupçonnait
        // (pusher-js émet un événement par frame, et un flush `'pre'` est une microtâche :
        // il est drainé entre deux frames) :
        //
        //   (a) COUPURE DE PRÉSENCE. Sur `connecting`/`disconnected`, pusher-js réinitialise
        //       ses canaux sans rien émettre : la liste reste périmée toute la coupure. Au
        //       retour il se ré-abonne et `here()` repart avec la liste COMPLÈTE. Un pair
        //       qui a rechargé pendant la coupure n'a jamais été vu partir.
        //   (b) RECHARGEMENT CHEVAUCHANT. Reverb n'émet pas `member_removed` tant que
        //       l'utilisateur tient une autre connexion, ni `member_added` s'il est déjà
        //       abonné (`InteractsWithPresenceChannels::userIsSubscribed`) : un rechargement
        //       dont la connexion neuve précède le ramassage de l'ancienne ne produit
        //       AUCUN événement de présence. Rien ne peut alors avoir lieu à ce tour-ci —
        //       seul le tour suivant, quel qu'en soit le motif, réparera.
        //
        // L'autorité est donc « membre de la room ET rien d'établi ». Le bail des peerId
        // borne l'autre moitié du même symptôme (composer un numéro mort) ; il ne remplace
        // pas celle-ci : sans entrée dans `newUsers`, aucun appel ne partait du tout, et un
        // diffuseur ne rappelait jamais le pair revenu — écran noir chez lui, sans erreur.
        //
        // ⚠️ `isConnectionEstablished`, JAMAIS `hasOpenConnection` : ce dernier est
        // volontairement optimiste et compte pour ouverte une `MediaConnection` en
        // `connecting`, c'est-à-dire l'état exact d'un pair qui vient de recharger. Il garde
        // d'ailleurs l'entrée de `requestOrConnectPeer`, donc un membre non établi mais
        // « ouvert » ne reçoit rien : la réconciliation échoue FERMÉE — elle sous-tire, elle
        // ne régresse pas. Le contournement serait la « fraîcheur par preuve de connexion »,
        // écartée en août parce que la preuve qu'elle cherche est produite par le bug.
        //
        // ⚠️ Réparation OPPORTUNISTE, pas garantie : PeerJS ne ferme que sur
        // `iceConnectionState` `failed`/`closed` et ne fait rien sur `disconnected`. Le tour
        // de présence peut donc arriver avant que la dégradation soit visible.
        //
        // ⚠️ Placée SOUS le garde ci-dessus, jamais au-dessus : au-dessus, le premier tour du
        // provider (`{ immediate: true }`, liste vide) composerait une room entière de
        // mémoire — « pas d'observation, pas d'émission » tomberait.
        //
        // Lecture de `ctx.connection.usersInRoom` : c'est la composition que
        // `getRoomUsersDiff` vient d'écrire, et la même que lisent les deux gardes
        // d'autorisation. Aucun état n'est ajouté ici.
        const newSlugs = new Set(newUsers.map(user => user.slug))
        const targets = [...new Set([
            ...newSlugs,
            ...ctx.connection.usersInRoom.filter(
                slug => !connections.isConnectionEstablished(slug)
            ),
        ])]

        // Mesh: tout le monde se connecte à tout le monde.
        if (ctx.topology.value === 'mesh') {
            targets.forEach(userSlug => {
                requestOrConnectPeer(userSlug, null, { preserveRetry: !newSlugs.has(userSlug) })

                // Si on est en train de partager l'écran, initier aussi la connexion 'screen'
                //
                // ⚠️ Réservé aux ARRIVANTS, hors réconciliation : `isConnectionEstablished`
                // ci-dessus porte sur le type courant, pas sur 'screen', et la reprise d'un
                // partage vers un membre déjà connu appartient à `startScreenCapture`, qui
                // itère `usersInRoom` à l'ouverture de la capture.
                if (ctx.media.isCapturing && newSlugs.has(userSlug)) {
                    requestOrConnectPeer(userSlug, 'screen')
                }
            })
        }
        // Star: le hub se connecte à tout le monde, les clients seulement au hub.
        else if (ctx.topology.value === 'star' && ctx.hubSlug.value) {
            if (ctx.isHub.value) {
                targets.forEach(userSlug => {
                    requestOrConnectPeer(userSlug, null, { preserveRetry: !newSlugs.has(userSlug) })
                })
            } else {
                // ⚠️ Inconditionnel, et c'est un défaut connu (`work/webrtc2-todo.md`) : le
                // client compose son hub même absent de la room. Laissé tel quel ici — c'est
                // aussi, par accident, la seule réconciliation qui existait, donc le corriger
                // avant celle ci-dessus régresserait la reprise d'un hub qui recharge.
                requestOrConnectPeer(ctx.hubSlug.value)
            }
        }
        // SFU: pas de maillage pair à pair côté client.
    }

    /**
     * Synchronise les connexions avec la liste des utilisateurs présents dans la room.
     *
     * ⚠️ Le verrou COALESCE, il ne jette pas. Un `return` sec sur verrou tenu perdait la
     * composition reçue — et pas seulement une action : `getRoomUsersDiff` est l'unique
     * écrivain de `usersInRoom`, `presenceSynced` et `roomMembers`. Un tour sauté laissait
     * donc trois états périmés d'un coup, dont l'allowlist de présence que lisent les deux
     * gardes d'autorisation. La fenêtre est celle de `waitForMeReady` (jusqu'à 15 s au
     * démarrage), c'est-à-dire le moment où la composition bouge le plus.
     *
     * On retient donc la DERNIÈRE liste reçue pendant le tour et on la rejoue à la
     * libération. Les intermédiaires sont écrasées sans être traitées : une liste de
     * présence n'a pas d'historique, seule la plus récente est vraie.
     *
     * Coût assumé du rejeu : `waitForMeReady` n'est PAS mémoïsée (contrairement à
     * `waitForPresenceSync`), donc chaque tour arme sa propre alarme de 15 s. Un contexte
     * qui n'est jamais prêt paie l'attente une seconde fois — borné, warné, et sans
     * conséquence : sans identité locale, rien ne peut se connecter de toute façon. Dans le
     * cas nominal l'identité est arrivée entre les deux tours, `waitForMeReady` résout de
     * façon synchrone et le rejeu ne coûte rien.
     *
     * @param {Array} users - Liste des utilisateurs (objets avec un slug) présents dans la room.
     * @returns {Promise<void>} Résout quand ce tour — ou, pour un appel coalescé, le rejeu
     *                          qui l'absorbe — est terminé.
     */
    const syncUsersConnections = async (users) => {
        if (!Array.isArray(users)) return

        if (syncUsersConnectionsLock.value) {
            // ⚠️ Retenue par RÉFÉRENCE, sans copie défensive : le tableau vient du canal de
            // présence et peut être muté en place d'ici le rejeu. C'est voulu — la lecture
            // au rejeu est alors la plus fraîche, là où une copie figerait un état déjà
            // périmé.
            _pendingUsers = users
            return new Promise((resolve) => { _syncWaiters.push(resolve) })
        }

        syncUsersConnectionsLock.value = true

        try {
            let batch = users

            while (batch !== null) {
                // ⚠️ Remis à null AVANT le tour, jamais après : un appel arrivé PENDANT
                // `_doSyncUsersConnections` doit survivre au tour qu'il chevauche.
                _pendingUsers = null

                await _doSyncUsersConnections(batch)

                // Le drain s'arrête net sur un arrêt en cours : rejouer après
                // `beginShutdown()` rouvrirait des connexions que le teardown vient de
                // fermer. Le tour DÉJÀ commencé, lui, va jusqu'au bout.
                batch = ctx.isShuttingDown.value ? null : _pendingUsers
            }
        } finally {
            _pendingUsers = null
            syncUsersConnectionsLock.value = false

            // Réveillés APRÈS la libération : un waiter qui rappellerait
            // syncUsersConnections depuis son `.then()` doit trouver le verrou libre, pas
            // se re-coalescer sur lui-même.
            //
            // ⚠️ Ils résolvent TOUJOURS — drain coupé par l'arrêt, ou tour qui lève. Une
            // promesse qui ne résout jamais est pire que le rejeu manqué ; l'exception,
            // elle, continue de se propager au premier appelant.
            _syncWaiters.splice(0).forEach(resolve => resolve())
        }
    }

    /**
     * Arrête l'observation et libère les timers de retry.
     * Appelé par l'orchestrateur lors d'un cleanup explicite (cleanupPeerConnection).
     */
    const stopPool = () => {
        unwatchPeerUnavailable()
        unwatchConnectionLost()
        retryManager.clearAll()
    }

    // Filet de sécurité : stoppe le watcher et les timers de retry si le composant
    // est détruit sans que cleanupPeerConnection() ait été appelé explicitement
    // (navigation abrupte, erreur, lazy-unmount, etc.).
    // ⚠️ NE PAS appeler cleanupPeerConnection() ici : createPeerContext.destroy()
    // s'exécute en premier (FIFO) et vide la session, ce qui rendrait
    // connections.closePeerConnection() inefficace.
    onUnmounted(() => {
        ctx.beginShutdown()   // 🛑 Bloque tout retry post-unmount
        stopPool()            // Arrête l'observation du signal + libère les timers en vol
    })

    return {
        requestOrConnectPeer,
        syncUsersConnections,
        clearRetry: retryManager.clearRetry,
        clearAllRetries: retryManager.clearAll,
        stopPool,

        /*---------------------------------
        | ÉTAT INTERNE (observable / debug)
        ----------------------------------*/
        syncUsersConnectionsLock,
    }
}
