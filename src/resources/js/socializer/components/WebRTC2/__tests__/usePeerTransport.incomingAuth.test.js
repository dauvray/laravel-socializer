/**
 * usePeerTransport.incomingAuth.test.js
 * Périmètre : authentification des connexions/appels WebRTC entrants
 *             (handlers localPeer.on('connection') et localPeer.on('call')).
 *
 * Faille couverte : [HAUTE] Aucune authentification des connexions WebRTC entrantes.
 * Avant d'appeler setUpConnectionListeners (data) ou call.answer (media), l'émetteur
 * déclaré (metadata.from) doit (a) avoir un format de slug valide, (b) être autorisé
 * par la présence OU par un mapping peerId concordant, et (c) ne pas usurper le slug
 * d'un autre membre si son peerId réel est déjà résolu — (c) n'est pas une
 * défense-en-profondeur mais le SEUL anti-usurpation du chemin présence, qui n'exige
 * rien d'autre qu'un slug déclaré présent dans remotePeers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { bootLocalPeer } from './helpers/bootLocalPeer.js'
import { resetPeerMock } from './__mocks__/peerjs.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'
import { ENDPOINTS, MAX_METADATA_BYTES, REMOTE_PEER_ID_LEASE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('usePeerTransport — authentification des connexions entrantes', () => {
    let ctx
    let app
    let transport
    let peerInstance

    const CTX_ID = 'test-data-app'
    const ROOM = 'app'

    beforeEach(async () => {
        resetPeerMock()
        ctx = createMockContext({
            contextId: CTX_ID,
            connection: { remotePeers: ['alice', 'bob'] },
        })

        ;[transport, app] = withSetup(() => usePeerTransport(ctx))

        // Crée le Peer singleton (mock), enregistre les handlers on('connection'|'call'),
        // et va jusqu'à `'open'` : sans cet événement le peer existe mais n'est JAMAIS
        // prêt, et l'admission serait jugée dans un état que la production ne connaît pas.
        peerInstance = await bootLocalPeer(() => transport.setLocalPeer(), { peerId: 'peer-me' })
    })

    afterEach(() => {
        app.unmount()
        vi.restoreAllMocks()
    })

    // Fabrique une DataConnection entrante factice.
    const incomingConn = (metadata, peer = 'peer-unknown') => ({
        peer,
        metadata: { type: 'data', room: ROOM, callbackKey: CTX_ID, ...metadata },
        close: vi.fn(),
        on: vi.fn(),
    })

    // Fabrique un MediaConnection entrant factice (type one-way pour rester synchrone).
    const incomingCall = (metadata, peer = 'peer-unknown') => ({
        peer,
        metadata: { type: 'stream', room: ROOM, callbackKey: CTX_ID, ...metadata },
        answer: vi.fn(),
        close: vi.fn(),
        on: vi.fn(),
    })

    // ── DataConnection ────────────────────────────────────────────────────────

    it('accepte une connexion data dont le `from` est un membre de la room', () => {
        const conn = incomingConn({ from: 'bob' })
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
        expect(conn.close).not.toHaveBeenCalled()
    })

    it('rejette une connexion data dont le `from` est absent de la room', () => {
        const conn = incomingConn({ from: 'mallory' })
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    it('rejette une connexion data sans `from`', () => {
        const conn = incomingConn({})
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    it('rejette une connexion data dont le `from` a un format de slug invalide', () => {
        const conn = incomingConn({ from: 'bob; rm -rf /' })
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    it('rejette une usurpation: `from` membre mais peerId réel mappé à un autre membre', () => {
        // alice est connue sous le peerId 'peer-alice'. Un attaquant connecté avec ce
        // peerId déclare from='bob' (autre membre) pour usurper son identité.
        ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
        const conn = incomingConn({ from: 'bob' }, 'peer-alice')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    it('accepte quand le `from` déclaré correspond au peerId réel mappé', () => {
        ctx.peerStore.addRemotePeerId('bob', 'peer-bob')
        const conn = incomingConn({ from: 'bob' }, 'peer-bob')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
        expect(conn.close).not.toHaveBeenCalled()
    })

    // ── MediaConnection (call) ──────────────────────────────────────────────────

    it('répond à un appel one-way dont le `from` est un membre de la room', () => {
        const call = incomingCall({ from: 'bob' })
        peerInstance._triggerEvent('call', call)

        expect(call.answer).toHaveBeenCalled()
        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(call)
        expect(call.close).not.toHaveBeenCalled()
    })

    it('rejette un appel dont le `from` est absent de la room (pas de stream livré)', () => {
        const call = incomingCall({ from: 'mallory' })
        peerInstance._triggerEvent('call', call)

        expect(call.answer).not.toHaveBeenCalled()
        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(call.close).toHaveBeenCalled()
    })

    it('rejette un appel sans `from`', () => {
        const call = incomingCall({})
        peerInstance._triggerEvent('call', call)

        expect(call.answer).not.toHaveBeenCalled()
        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(call.close).toHaveBeenCalled()
    })

    // ── Trace « un flux de ce pair est en route » ───────────────────────────────
    // Un appel one-way n'existe que si l'émetteur a un flux vivant, et cet événement
    // arrive dès la réception de l'offre — avant ICE, donc avant le `stream`. C'est ce
    // qui permet à l'UI d'attendre un pair déjà en train de diffuser quand on arrive
    // dans la room, sans heuristique (cf. useAwaitedStreams / useBroadcastPresence).

    it('enregistre le pair comme diffuseur dès l\'appel one-way entrant', () => {
        peerInstance._triggerEvent('call', incomingCall({ from: 'bob' }))

        expect(ctx.markAnnouncedStream).toHaveBeenCalledWith('bob', 'call')
        expect(ctx.announcedStreamPeers.value).toEqual(['bob'])
    })

    it('n\'enregistre rien pour un appel refusé', () => {
        peerInstance._triggerEvent('call', incomingCall({ from: 'mallory' }))

        expect(ctx.announcedStreamPeers.value).toEqual([])
    })

    // ── Appels DIRECTS hors room de présence (mapping peerId vérifié) ───────────
    // Un appel visio/vocal 1-à-1 est autorisé via la signalisation backend
    // (peer-access-permission → acceptCallFromPeer/openCallBetweenPeer peuple
    // peerStore.remotePeersId AVANT que la peer.call entrante n'arrive). Le garde
    // s'appuie exclusivement sur ce mapping (et NON sur currentCallUsers qui n'est
    // qu'un état UI), donc la présence du slug dans le mapping ET la correspondance
    // avec le peerId réel tiennent lieu d'autorisation ET d'anti-usurpation.

    it("accepte une connexion data d'un interlocuteur d'appel direct (mapping peerId) hors room", () => {
        // mallory n'est PAS dans remotePeers, mais la signalisation a peuplé le mapping.
        ctx.peerStore.addRemotePeerId('mallory', 'peer-mallory')
        const conn = incomingConn({ from: 'mallory' }, 'peer-mallory')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
        expect(conn.close).not.toHaveBeenCalled()
    })

    it("répond à un appel visio d'un interlocuteur d'appel direct (mapping peerId) hors room", async () => {
        ctx.peerStore.addRemotePeerId('mallory', 'peer-mallory')
        ctx.media.currentStream = { id: 'local-stream' } // stream local présent → answer immédiat
        const call = incomingCall({ type: 'visio', from: 'mallory' }, 'peer-mallory')
        peerInstance._triggerEvent('call', call)

        await vi.waitFor(() => expect(call.answer).toHaveBeenCalled())
        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(call)
        expect(call.close).not.toHaveBeenCalled()
    })

    // ── Le bail ne touche pas l'admission ──────────────────────────────────────
    // Le mapping a trois classes de lecteurs : composer un appel (sous bail), servir
    // d'allowlist au chemin (b) ci-dessus, et résoudre peerId → slug pour
    // l'anti-usurpation. Seul le PREMIER est sous bail. Ces deux tests le tiennent des
    // deux côtés : ce qui doit rester admis, et ce qui doit rester refusé.
    //
    // Ce fichier tourne en timers réels : `setSystemTime` seul suffit à avancer l'horloge
    // (il ne mocke que `Date`), et `restoreAllMocks` de l'afterEach ne la rend pas — d'où
    // le `useRealTimers` explicite.

    it("⭐ admet encore un interlocuteur d'appel direct dont le bail a expiré", () => {
        // Sans quoi une visio 1-à-1 plus longue que REMOTE_PEER_ID_LEASE_MS commencerait à
        // refuser les reconnexions de son interlocuteur — et un refus d'admission n'est
        // rattrapable par personne (PeerJS ne notifie pas le `close()` d'un appel jamais
        // répondu).
        ctx.peerStore.addRemotePeerId('mallory', 'peer-mallory')
        vi.setSystemTime(Date.now() + REMOTE_PEER_ID_LEASE_MS + 1)

        const conn = incomingConn({ from: 'mallory' }, 'peer-mallory')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
        expect(conn.close).not.toHaveBeenCalled()

        vi.useRealTimers()
    })

    it("⭐ refuse encore une usurpation dont le bail a expiré", () => {
        // Le pendant, et c'est celui qui compte : une résolution inverse périmable serait
        // un contournement PLANIFIABLE — il suffirait à l'attaquant d'attendre l'expiration
        // du bail pour que `resolvedSlug` revienne null et que le refus sur contradiction
        // cesse de mordre.
        ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
        vi.setSystemTime(Date.now() + REMOTE_PEER_ID_LEASE_MS + 1)

        const conn = incomingConn({ from: 'bob' }, 'peer-alice')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()

        vi.useRealTimers()
    })

    it("rejette une connexion data d'un slug dans currentCallUsers mais SANS mapping peerId (l'état UI ne fait pas autorité)", () => {
        // Garantit qu'on ne regresse pas vers l'ancienne allowlist basée sur currentCallUsers.
        ctx.addCurrentCallUser('mallory', 'visio')
        // PAS d'appel à peerStore.addRemotePeerId — le mapping signalé est absent.
        const conn = incomingConn({ from: 'mallory' }, 'peer-mallory')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    // ── Contexte au démarrage : la présence n'est pas encore connue ─────────────
    // `remotePeers` vide ne dit pas « personne n'est membre », il dit « je ne sais pas
    // encore ». Conclure dessus refuse le `peer.call` qui apporte son flux à un arrivant,
    // et ce refus n'est rattrapable par personne : PeerJS ne notifie pas le `close()`
    // d'un appel jamais répondu, et l'émetteur voit sa MediaConnection en `connecting`
    // (donc `hasOpenConnection` vraie, donc son moteur de retry s'arrête). La décision
    // attend donc la première synchronisation de présence — sans jamais s'assouplir.

    const unsyncedCtx = () => createMockContext({
        contextId: CTX_ID,
        connection: { remotePeers: [], presenceSynced: false },
    })

    it('diffère la décision tant que la présence est inconnue, puis admet le membre annoncé', async () => {
        app.unmount()
        // ⚠️ Avant de remonter : sans ce reset, l'instance du `beforeEach` est encore la
        // « dernière connue » et l'attente de `bootLocalPeer` se satisferait d'elle —
        // l'`'open'` partirait sur le peer du contexte démonté.
        resetPeerMock()
        ctx = unsyncedCtx()
        ;[transport, app] = withSetup(() => usePeerTransport(ctx))
        peerInstance = await bootLocalPeer(() => transport.setLocalPeer(), { peerId: 'peer-me' })

        const call = incomingCall({ from: 'alice' }, 'peer-alice')
        peerInstance._triggerEvent('call', call)

        // Rien n'est tranché : ni répondu, ni fermé.
        await Promise.resolve()
        expect(call.answer).not.toHaveBeenCalled()
        expect(call.close).not.toHaveBeenCalled()

        // La présence Reverb arrive — alice était bien membre depuis le début.
        ctx.connection.remotePeers = ['alice']
        ctx.connection.presenceSynced = true

        await vi.waitFor(() => expect(call.answer).toHaveBeenCalled())
        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(call)
        expect(call.close).not.toHaveBeenCalled()
    })

    it("refuse quand la présence arrive enfin et ne nomme pas l'émetteur", async () => {
        app.unmount()
        resetPeerMock()
        ctx = unsyncedCtx()
        ;[transport, app] = withSetup(() => usePeerTransport(ctx))
        peerInstance = await bootLocalPeer(() => transport.setLocalPeer(), { peerId: 'peer-me' })

        const call = incomingCall({ from: 'mallory' }, 'peer-mallory')
        peerInstance._triggerEvent('call', call)

        ctx.connection.remotePeers = ['alice']
        ctx.connection.presenceSynced = true

        // Attendre n'est pas admettre : la présence connue, le garde tranche comme avant.
        await vi.waitFor(() => expect(call.close).toHaveBeenCalled())
        expect(call.answer).not.toHaveBeenCalled()
        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
    })

    it("rejette une connexion data d'un interlocuteur d'appel direct dont le peerId réel ne correspond pas au mapping", () => {
        // mallory est mappée à 'peer-mallory' via signalisation, mais la connexion entrante
        // arrive avec un autre peerId — usurpation rejetée par le chemin appel direct.
        ctx.peerStore.addRemotePeerId('mallory', 'peer-mallory')
        const conn = incomingConn({ from: 'mallory' }, 'peer-attacker')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    // ── Anti-usurpation inconditionnelle ────────────────────────────────────────
    // La règle 3 ne s'exécutait que sur le chemin présence. Elle s'applique désormais
    // aux deux, et son verdict « peerId non résolu » ne vaut PAS refus : sur le chemin
    // présence, le mapping du récepteur n'est écrit que lorsque c'est lui qui ouvre la
    // connexion, donc il est structurellement absent quand l'appel entrant arrive le
    // premier (mesuré par scenarios/incomingMappingInvariant.test.js). Refuser dessus
    // fermerait toute diffusion en room.

    it('admet un membre de la room dont le peerId est neuf et non mappé, et trace la non-corroboration', () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
        // Cas NOMINAL de l'arrivant tardif : bob est membre, son peerId n'est mappé
        // nulle part chez nous. Contre-épreuve de la lecture « non résolu ⇒ rejet ».
        const conn = incomingConn({ from: 'bob' }, 'peer-bob-fresh')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
        expect(conn.close).not.toHaveBeenCalled()
        expect(debugSpy).toHaveBeenCalledWith(
            expect.stringContaining('Admission entrante non corroborée'),
            expect.objectContaining({ declaredFrom: 'bob', senderPeerId: 'peer-bob-fresh' })
        )
    })

    it("rejette un interlocuteur d'appel direct dont le peerId est aussi mappé à un membre de la room", () => {
        // Le chemin (b) ne vérifie la concordance que dans le sens slug → peerId : il
        // admettait donc mallory alors que ce même peerId identifie déjà alice. La
        // résolution inverse, désormais appliquée hors du chemin présence, le refuse.
        ctx.peerStore.addRemotePeerId('alice', 'peer-shared')
        ctx.peerStore.addRemotePeerId('mallory', 'peer-shared')
        const conn = incomingConn({ from: 'mallory' }, 'peer-shared')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    it('ne trace aucune non-corroboration quand le peerId entrant est résolu au slug déclaré', () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
        ctx.peerStore.addRemotePeerId('bob', 'peer-bob')
        peerInstance._triggerEvent('connection', incomingConn({ from: 'bob' }, 'peer-bob'))

        expect(debugSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('Admission entrante non corroborée'),
            expect.anything()
        )
    })

    /*
    |--------------------------------------------------------------------------
    | Taille de la metadata (E2) — le premier garde du chemin, avant les logs
    |--------------------------------------------------------------------------
    |
    | `conn.metadata` est un objet du réseau, non borné. Le garde va AVANT tout le
    | reste, et notamment avant les `console.warn` de non-résolution de contexte :
    | ceux-là journalisent l'objet ENTIER, et c'est le pair distant qui décide de les
    | déclencher — il contrôle `callbackKey`, donc le fait qu'aucun contexte ne se
    | résolve. Un garde placé après eux serait vide de son objet.
    */

    describe('taille de la metadata entrante', () => {
        // Dépasse MAX_METADATA_BYTES (4 Ko) tout en restant loin de MAX_PAYLOAD_BYTES :
        // c'est bien le plafond de metadata qui doit mordre, pas celui des payloads.
        const bloat = 'x'.repeat(MAX_METADATA_BYTES)

        beforeEach(() => {
            vi.spyOn(console, 'warn').mockImplementation(() => {})
        })

        it('ferme une connexion data dont la metadata dépasse le plafond', () => {
            const conn = incomingConn({ from: 'bob', bloat })
            peerInstance._triggerEvent('connection', conn)

            expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
            expect(conn.close).toHaveBeenCalled()
        })

        it('ferme un appel dont la metadata dépasse le plafond', () => {
            const call = incomingCall({ from: 'bob', bloat })
            peerInstance._triggerEvent('call', call)

            expect(call.answer).not.toHaveBeenCalled()
            expect(call.close).toHaveBeenCalled()
        })

        it('admet toujours une metadata nominale', () => {
            const conn = incomingConn({ from: 'bob', fromName: 'Bob Martin' })
            peerInstance._triggerEvent('connection', conn)

            expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
        })

        /**
         * Le point de la tâche : un pair qui vise le `console.warn` de non-résolution
         * de contexte — en fournissant un `callbackKey` inconnu — ne doit pas pouvoir y
         * faire passer un objet non borné. Le garde de taille est en amont, donc ce
         * warn n'est jamais atteint.
         */
        it('ne journalise pas l\'objet quand il est surdimensionné, même sur un contexte introuvable', () => {
            const conn = incomingConn({ from: 'bob', bloat, callbackKey: 'contexte-inconnu' })
            peerInstance._triggerEvent('connection', conn)

            const logged = console.warn.mock.calls.flat()
                .map(arg => JSON.stringify(arg))
                .join(' ')

            expect(logged).not.toContain(bloat)
            expect(logged).not.toContain('Aucun contexte trouvé')
            expect(conn.close).toHaveBeenCalled()
        })
    })

    /*
    |--------------------------------------------------------------------------
    | Corroboration d'identité — la fermeture du chemin (a)
    |--------------------------------------------------------------------------
    |
    | LA FAILLE. Le chemin (a) admettait sur le seul `metadata.from`, un champ que
    | l'émetteur choisit : un membre de la room qui ouvrait un SECOND `new Peer()`
    | obtenait un UUID que rien ne mappait — donc `resolvedSlug = null`, donc aucune
    | contradiction à opposer — et parlait sous l'identité d'un autre membre.
    |
    | Le serveur signe désormais `{peerId, slug, exp}` (le slug venant d'`Auth::user()`),
    | le pair la transporte dans sa `metadata`, et le récepteur la fait vérifier. Les
    | cas ci-dessous couvrent les QUATRE issues, et la quatrième est celle qu'on oublie.
    |
    | ⚠️ Ces admissions-ci sont ASYNCHRONES : `_admitIncoming` rend une promesse dès qu'il
    | y a un verdict à demander, et le dispatcher l'attend (`if (typeof v !== 'boolean')`).
    | D'où le `await Promise.resolve()` — sans lui, l'assertion précède la décision et le
    | cas verdirait pour la mauvaise raison. Les cas plus haut, eux, restent synchrones :
    | rien n'y est présenté, donc il n'y a rien à demander.
    */

    describe('corroboration d\'identité par attestation', () => {
        const ATTESTATION = 'charge.signature'

        beforeEach(() => {
            vi.spyOn(console, 'warn').mockImplementation(() => {})
            vi.spyOn(console, 'debug').mockImplementation(() => {})
        })

        /**
         * Laisse la chaîne de vérification se dérouler entièrement.
         *
         * ⚠️ Un `setTimeout` et non N `await Promise.resolve()`, et ce n'est pas de la superstition :
         * la chaîne traverse `_concludeIncoming` → `_attestedSlugFor` → `verifyPeerAttestation` →
         * `Promise.race` → `.finally`, soit un nombre de microtâches que personne ne doit avoir à
         * recompter. Un compte trop court rendait ce fichier vert POUR LA MAUVAISE RAISON sur les
         * cas d'admission (la décision n'était pas encore prise) et faux sur celui de la
         * mémoïsation. Une macrotâche les vide toutes, quel que soit leur nombre.
         */
        const laisserConclure = () => new Promise((resolve) => { setTimeout(resolve, 0) })

        /** Les appels réellement partis vers la route de vérification, et eux seuls. */
        const verifications = () => ctx.AjaxService.load.mock.calls
            .filter(([endpoint]) => endpoint === ENDPOINTS.VERIFY_PEER_ATTESTATION)

        /** Le serveur nomme `slug` pour tout peerId présenté. */
        const serveurRepond = (slug) => {
            ctx.AjaxService.load.mockResolvedValue({ slug })
        }

        it('admet un membre dont l\'attestation le nomme comme il se déclare', async () => {
            serveurRepond('bob')
            const conn = incomingConn({ from: 'bob', attestation: ATTESTATION }, 'peer-bob-neuf')

            peerInstance._triggerEvent('connection', conn)
            await laisserConclure()

            expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
            // Corroborée : le compteur d'observation ne bouge pas. C'est lui qu'on relira pour
            // décider d'activer `enforce`.
            expect(ctx.peerStore.uncorroboratedAdmissions).toBe(0)
        })

        it('REFUSE un membre dont l\'attestation nomme quelqu\'un d\'autre', async () => {
            // ⚠️ LE CAS DE LA FAILLE. Mallory est membre de la room, ouvre un second `Peer`, et se
            // déclare « alice ». Le serveur ne lui a jamais délivré qu'une attestation à SON nom :
            // la contradiction est ce qui la refuse. Avant ce mécanisme, `resolvedSlug` valait
            // `null` et elle était admise.
            ctx.connection.remotePeers = ['alice', 'bob', 'mallory']
            serveurRepond('mallory')
            const conn = incomingConn({ from: 'alice', attestation: ATTESTATION }, 'peer-mallory-2')

            peerInstance._triggerEvent('connection', conn)
            await laisserConclure()

            expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        })

        it('admet en la TRAÇANT une identité non corroborée, tant qu\'`enforce` est inactif', async () => {
            // Le mode d'observation : on mesure la surface sans rien casser. C'est ce compteur qui
            // décide du passage à `enforce` — tant qu'il bouge en usage nominal, refuser couperait
            // des pairs légitimes.
            serveurRepond(null)
            const conn = incomingConn({ from: 'bob', attestation: 'forgee.xxx' }, 'peer-bob-neuf')

            peerInstance._triggerEvent('connection', conn)
            await laisserConclure()

            expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
            expect(ctx.peerStore.uncorroboratedAdmissions).toBe(1)
            // Le serveur a TRANCHÉ, et le pair présentait bien quelque chose : ce refus-là existe
            // aussi dans le journal serveur. Les deux compteurs de nature différente restent à zéro.
            expect(ctx.peerStore.unattestedAdmissions).toBe(0)
            expect(ctx.peerStore.unverifiableAdmissions).toBe(0)
        })

        it('compte À PART un pair admis sans présenter la moindre attestation', async () => {
            // ⚠️ L'ANGLE MORT DU JOURNAL SERVEUR, et la raison pour laquelle la mesure a deux
            // moitiés. Ce pair ne présente rien, donc `_admitIncoming` ne DEMANDE rien : aucune
            // requête ne part et le serveur ne saura jamais qu'il est passé. C'est pourtant le cas
            // majoritaire de la phase d'observation — l'onglet resté sur un bundle antérieur, celui
            // pour lequel `enforce` est faux — et le seul que le déploiement, et non une enquête,
            // fait disparaître. Le confondre avec une forge ferait prendre la décision inverse.
            const conn = incomingConn({ from: 'bob' }, 'peer-bob-neuf')

            peerInstance._triggerEvent('connection', conn)
            await laisserConclure()

            expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
            expect(ctx.peerStore.uncorroboratedAdmissions).toBe(1)
            // SOUS-ENSEMBLE du précédent, jamais à sa place : c'est ce qui rend la somme lisible.
            expect(ctx.peerStore.unattestedAdmissions).toBe(1)
            expect(verifications()).toHaveLength(0)
        })

        it('REFUSE la même identité non corroborée sous `enforce`', async () => {
            ctx.peerStore.attestationEnforce = true
            serveurRepond(null)
            const conn = incomingConn({ from: 'bob', attestation: 'forgee.xxx' }, 'peer-bob-neuf')

            peerInstance._triggerEvent('connection', conn)
            await laisserConclure()

            expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        })

        it('REFUSE sous `enforce` un pair qui ne présente aucune attestation', async () => {
            // Aucun aller-retour ici — il n'y a rien à vérifier —, donc la décision reste
            // SYNCHRONE : c'est le chemin d'un pair resté sur un bundle antérieur, et c'est
            // exactement ce que la phase d'observation sert à faire disparaître avant de basculer.
            ctx.peerStore.attestationEnforce = true
            const conn = incomingConn({ from: 'bob' }, 'peer-bob-neuf')

            peerInstance._triggerEvent('connection', conn)

            expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
            expect(verifications()).toHaveLength(0)
        })

        it('ADMET — même sous `enforce` — quand le serveur de vérification ne répond pas', async () => {
            // ⚠️ LE FAIL-OPEN, et c'est le cas qu'on oublie. Refuser sur une indisponibilité d'infra
            // transformerait un incident serveur en coupure de visio non rattrapable, et offrirait
            // le levier correspondant : rendre la route injoignable suffirait à fermer les rooms.
            //
            // Non compté par le compteur de DÉCISION, non plus : celui-là mesure la surface du
            // contrôle, pas les pannes. Mais compté à part, et c'est ce qui manquait : un journal
            // serveur vide ne distingue pas « aucun refus » de « aucune requête », et basculer sur
            // cette confusion mettrait `enforce` en service sur une mesure qui n'a jamais tourné.
            ctx.peerStore.attestationEnforce = true
            ctx.AjaxService.load.mockRejectedValue(new Error('503'))
            const conn = incomingConn({ from: 'bob', attestation: ATTESTATION }, 'peer-bob-neuf')

            peerInstance._triggerEvent('connection', conn)
            await laisserConclure()

            expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
            expect(ctx.peerStore.uncorroboratedAdmissions).toBe(0)
            expect(ctx.peerStore.unverifiableAdmissions).toBe(1)
        })

        it('ne paie qu\'UN aller-retour par peerId, refus compris', async () => {
            // Sans mémoïsation des refus, un pair refusé qui insiste ferait payer une requête à
            // chacune de ses tentatives — à la cadence qu'il choisit.
            serveurRepond(null)

            for (let i = 0; i < 3; i += 1) {
                peerInstance._triggerEvent('connection', incomingConn(
                    { from: 'bob', attestation: 'forgee.xxx' }, 'peer-bob-neuf',
                ))
                await laisserConclure()
            }

            expect(verifications()).toHaveLength(1)
        })

        it('n\'interroge pas le serveur quand le mapping résout déjà l\'identité (chemin (b))', async () => {
            // La visio 1-à-1 et `data-app` ne doivent RIEN payer : leur mapping concordant EST la
            // corroboration. C'est aussi ce qui garde leur admission synchrone.
            ctx.peerStore.addRemotePeerId('bob', 'peer-bob')
            const conn = incomingConn({ from: 'bob', attestation: ATTESTATION }, 'peer-bob')

            peerInstance._triggerEvent('connection', conn)

            expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
            expect(verifications()).toHaveLength(0)
        })

        it('n\'écrit JAMAIS l\'attestation dans l\'allowlist du chemin (b)', async () => {
            // ⚠️ Le point de sécurité de tout le mécanisme. Verser un verdict dans `remotePeersId`
            // ferait d'un pair attesté un « interlocuteur d'appel direct vérifié » sans qu'aucun
            // appel n'ait été autorisé — l'auto-inscription que le registre `authorizedCallPeers` a
            // fermée, remise en service par une autre porte.
            serveurRepond('bob')
            const conn = incomingConn({ from: 'bob', attestation: ATTESTATION }, 'peer-bob-neuf')

            peerInstance._triggerEvent('connection', conn)
            await laisserConclure()

            expect(ctx.peerStore.getRemotePeerId('bob')).toBeUndefined()
            expect(ctx.peerStore.hasRemotePeerId('bob')).toBe(false)
            // Le verdict, lui, vit bien — dans SON registre.
            expect(ctx.peerStore.getAttestedPeer('peer-bob-neuf')?.slug).toBe('bob')
        })
    })
})
