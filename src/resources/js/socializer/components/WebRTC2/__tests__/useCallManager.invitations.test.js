/**
 * useCallManager.invitations.test.js — la jonction call manager × VRAI usePeerCore
 *
 * `useCallManager.test.js` double le core, et `usePeerCore.test.js` n'a pas de call manager :
 * ce qui tient au JOINT entre les deux n'est vu par aucun des deux fichiers (le « 0 croisé »
 * de `docs/architecture/tests.md`). Ce fichier câble les deux vrais composables ; le reste
 * (media, connexions, transport, pool) est doublé à l'identique de `useCallManager.test.js`.
 *
 * ── Ce qui tient au joint ────────────────────────────────────────────────────────────────
 *
 * `requestAuthorizationRemotePeerId` peut voir son invitation annulée PENDANT son premier
 * envoi — un refus distant qui arrive avant la réponse HTTP (plausible quand l'appelé refuse
 * d'office, « occupé ⇒ refus » : lu, non sondé). Elle n'arme alors pas le moteur de retry,
 * mais elle rend quand même son `inviteId`, et ce retour est porteur : `startCallWithPeer`
 * lit `null` comme « rien n'est parti » et rejoue le chemin du refus. Si l'utilisateur a
 * rappelé entre-temps, ce refus rejoué frappe le SECOND appel — il retire le pair, éteint la
 * nouvelle chaîne d'invitation et ramène la FSM à IDLE.
 *
 * ── Contrôles de harnais (mesurés le 2026-10-27) ─────────────────────────────────────────
 *
 *   | Neutralisé                                                     | Rougit  |
 *   |----------------------------------------------------------------|---------|
 *   | `return inviteId` du premier envoi supplanté → `return null`   | le cas  |
 *   | garde du retour du premier envoi retirée                       | le cas  |
 *   | code d'avant le lot (usePeerCore, usePeerRetry, pool)          | le cas  |
 *
 * La première ligne n'est vue que d'ici : `usePeerCore.test.js` rend 0 cas sous cette
 * mutation (mesuré par la relecture du lot).
 *
 * ── L'arrêt complet éteint l'invitation (mesurés le 2026-10-27) ──────────────────────────
 *
 *   | Neutralisé dans `stopCallWithPeers` (full)        | Rougit                           |
 *   |---------------------------------------------------|----------------------------------|
 *   | `core.clearAllCallInviteRetries()`                | « plus aucune relance »          |
 *   | `peerStore.clearCallInvitesForContext(...)`       | les deux cas d'acceptation       |
 *   | `useCallManager.js` d'avant le lot (b08faba)      | les trois cas                    |
 *
 * ⚠️ Ces cas passent par le DOUBLE du store : le prédicat de `clearCallInvitesForContext`
 * (`inviteId`, portée `contextId`) y est recopié, et ses deux mutants laissent la suite entière
 * verte. Le vrai verbe n'est épinglé que par `peers2Store.remotePeerId.test.js` — même
 * arbitrage que `clearWaitingRemotePeerIdsForContext`.
 *
 * ── Une réponse ne vaut que pour SON invitation (mesurés le 2026-10-27) ──────────────────
 *
 *   | Neutralisé dans `useCallManager`                       | Rougit                       |
 *   |--------------------------------------------------------|------------------------------|
 *   | garde du refus (`_consumeRefusedInvitation` → true)    | 4 cas                        |
 *   | identité → présence de l'entrée en vol                 | « même room »                |
 *   | consommation de l'invitation refusée                   | « consomme son invitation »  |
 *   | arrêt de la relance remis en tête                      | les deux réponses tardives   |
 *   | `useCallManager.js` et `usePeerCore.js` de 8d03a37      | 5 cas, plus le contrat       |
 *   |                                                        | d'envoi de `usePeerCore`     |
 *   | `invalidateRemotePeerId` d'avant (store et double)     | « un peerId mort »           |
 *
 * ⚠️ « Un peerId mort » est VERT sur 8d03a37, et c'est voulu : sans garde, tout refus fermait
 * l'appel. Il est le témoin de la régression que la garde fabriquait tant qu'un `peer-unavailable`
 * effaçait aussi les invitations — un refus légitime ignoré, l'appelant en `calling` pour toujours.
 *
 * ⚠️ Les réponses sont fabriquées ici, pas émises par un core appelé : le contrat d'envoi du
 * refus (`room` + `inviteId`) est épinglé à part, dans `usePeerCore.test.js`. Le cas « refus de
 * l'invitation vivante » est vert sur les deux versions : c'est un contrat, pas un témoin.
 *
 * ── Le verdict rendu à Notifications (mesurés le 2026-10-28) ─────────────────────────────
 *
 *   | Neutralisé                                                  | Rougit                       |
 *   |-------------------------------------------------------------|------------------------------|
 *   | refus périmé → `return true`                                | les deux ⭐ du `describe`     |
 *   | `useCallManager.js` d'avant le lot (aucun retour)           | les cinq cas du `describe`   |
 *
 * La lecture du verdict est gardée par `Notifications.test.js`, qui double le moteur : chacune
 * des deux moitiés rougit sans l'autre (mesuré).
 *
 * ── Un départ ne vaut que pour SON appel (mesurés le 2026-10-29) ─────────────────────────
 *
 *   | Neutralisé dans la garde de `handleRemoteDeparture`  | Rougit                             |
 *   |------------------------------------------------------|------------------------------------|
 *   | la garde entière                                     | les deux ⭐ du `describe`           |
 *   | la condition « une room d'appel est posée »          | 5 cas `stream`, hors de ce fichier |
 *   | la condition « le départ porte une room »            | « la séquence elle-même… »         |
 *
 * La deuxième ligne rougit ailleurs, et c'est le fait : sans room d'appel, rien n'est à comparer —
 * c'est ce qui laisse passer les départs de diffusion (`usePeerOrchestrator.callbacks`,
 * `scenarios/peerDeparture`, `scenarios/broadcastLifecycle`). Les deux autres cas du `describe` sont
 * verts sur le code d'avant : ce sont des contrats, pas des témoins.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { seedReadyPeer } from './helpers/bootLocalPeer.js'
import { usePeerCore } from '~socializer/components/WebRTC2/Composables/usePeerCore.js'
import { useCallManager } from '~socializer/components/WebRTC2/Composables/useCallManager.js'
import { CALL_STATES } from '~socializer/components/WebRTC2/Composables/utils/useCallStateMachine.js'
import { ENDPOINTS } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('useCallManager × usePeerCore — invitations', () => {
    let ctx
    let app
    let core
    let cm
    let pool

    beforeEach(() => {
        vi.useFakeTimers()
        // Jitter neutralisé : l'ordre de réveil des chaînes doit être déterministe.
        vi.spyOn(Math, 'random').mockReturnValue(0)
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        ctx = createMockContext()
        seedReadyPeer(ctx.peerStore, 'local-peer-id-mock')
        // `withSetup` : le moteur de retry du core enregistre un `onUnmounted`.
        ;[core, app] = withSetup(() => usePeerCore(ctx))

        pool = { requestOrConnectPeer: vi.fn(), clearRetry: vi.fn(), clearAllRetries: vi.fn() }
        cm = useCallManager(ctx, {
            core,
            media: {
                startCurrentStream: vi.fn().mockResolvedValue(undefined),
                stopCurrentStream: vi.fn(),
                createVideoElement: vi.fn(),
                removeVideoElement: vi.fn(),
                cleanupCallPlayers: vi.fn(),
            },
            connections: { closePeerConnection: vi.fn() },
            transport: { setLocalPeer: vi.fn(async () => undefined) },
            pool,
        })
    })

    afterEach(() => {
        app.unmount()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    /** Room d'appel de chaque POST d'invitation, dans l'ordre d'émission. */
    const roomsInvitees = () => ctx.AjaxService.load.mock.calls
        .filter(([url]) => url === ENDPOINTS.SEND_ALERT_TO_USER)
        .map(([, , data]) => data.options.room)

    it('un refus reçu pendant le premier envoi ne frappe pas le rappel qui l\'a suivi', async () => {
        let repondreEnvoi
        ctx.AjaxService.load.mockImplementationOnce(
            () => new Promise((resolve) => { repondreEnvoi = () => resolve({ data: {} }) }),
        )
        const premierAppel = cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })

        // Le refus d'alice arrive avant la réponse HTTP — le chemin de
        // `.ResponseToAuthorizationPeer` dans Notifications.vue.
        await cm.openCallBetweenPeer({ fromUserSlug: 'alice', status: false, options: { type: 'visio' } })
        expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)

        // L'utilisateur rappelle alice, puis la réponse du premier envoi arrive enfin.
        await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-2' })
        repondreEnvoi()
        await premierAppel

        expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
        expect(ctx.session.currentCallUsers).toEqual([{ userSlug: 'alice', type: 'visio' }])

        await vi.advanceTimersByTimeAsync(30_000)

        const relances = roomsInvitees().slice(2)
        expect(relances).not.toContain('call-1')
        expect(relances.length).toBeGreaterThan(1)
    })

    describe('un arrêt complet pendant `calling` éteint l\'invitation', () => {
        /** L'arrêt de `Notifications.onStopCall` : les participants courants, signalés au distant. */
        const raccrocher = () => cm.stopCallWithPeers([...ctx.session.currentCallUsers], true, { mode: 'full' })

        it('plus aucune relance ne part, et aucun abandon ne tombe après l\'arrêt', async () => {
            await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            expect(roomsInvitees()).toEqual(['call-1'])

            await raccrocher()
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)

            await vi.advanceTimersByTimeAsync(60_000)

            expect(roomsInvitees()).toEqual(['call-1'])
            expect(ctx.inviteAbandonedSignal.value).toBeNull()
        })

        it('une acceptation arrivée après l\'arrêt n\'autorise pas le pair', async () => {
            const inviteId = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await raccrocher()

            // L'alerte d'alice était encore affichée : elle accepte l'invitation déjà livrée.
            await cm.openCallBetweenPeer({
                fromUserSlug: 'alice',
                status: true,
                options: { room: 'call-1', type: 'visio', peerId: 'alice-peer-id', inviteId },
            })

            expect(ctx.isAuthorizedCallPeer('alice')).toBe(false)
            expect(ctx.peerStore.hasRemotePeerId('alice')).toBe(false)
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })

        /**
         * Le pire cas, et c'est l'enchaînement naturel d'un bouton « annuler » : on annule alice,
         * on appelle bob, et l'acceptation tardive d'alice tombe pendant que bob sonne. Avant le
         * lot, elle passait la garde et faisait entrer alice dans l'appel de bob — CONNECTED avec
         * les deux, alice autorisée, connexion lancée vers elle — avant que bob ait répondu.
         */
        it('une acceptation tardive n\'entre pas dans l\'appel suivant', async () => {
            const inviteAlice = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await raccrocher()
            const inviteBob = await cm.startCallWithPeer({ toUserSlug: 'bob', type: 'visio', room: 'call-2' })

            await cm.openCallBetweenPeer({
                fromUserSlug: 'alice',
                status: true,
                options: { room: 'call-1', type: 'visio', peerId: 'alice-peer-id', inviteId: inviteAlice },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
            expect(ctx.session.currentCallUsers.map((u) => u.userSlug)).toEqual(['bob'])
            expect(ctx.isAuthorizedCallPeer('alice')).toBe(false)
            expect(pool.requestOrConnectPeer).not.toHaveBeenCalledWith('alice')

            // L'appel de bob, lui, n'a rien perdu.
            await cm.openCallBetweenPeer({
                fromUserSlug: 'bob',
                status: true,
                options: { room: 'call-2', type: 'visio', peerId: 'bob-peer-id', inviteId: inviteBob },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)
            expect(ctx.session.currentCallUsers.map((u) => u.userSlug)).toEqual(['bob'])
        })
    })

    describe('une réponse ne vaut que pour SON invitation', () => {
        const raccrocher = () => cm.stopCallWithPeers([...ctx.session.currentCallUsers], true, { mode: 'full' })

        /**
         * La séquence de `.ResponseToAuthorizationPeer` dans `Notifications.vue`, côté FSM : le
         * toast et `close-call` n'y touchent pas, et la relance n'y est plus arrêtée avant la
         * garde — `openCallBetweenPeer` est le seul à décider.
         */
        const recevoirReponse = (event) => cm.openCallBetweenPeer(event)

        /** Rappel d'alice après annulation : la 1re alerte peut encore répondre. */
        const annulerPuisRappeler = async () => {
            const premiere = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await raccrocher()
            const seconde = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-2' })
            return { premiere, seconde }
        }

        it('le refus tardif de la 1re alerte ne coupe pas le rappel', async () => {
            const { premiere } = await annulerPuisRappeler()

            await recevoirReponse({
                fromUserSlug: 'alice',
                status: false,
                options: { type: 'visio', room: 'call-1', inviteId: premiere },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
            expect(ctx.session.currentCallUsers).toEqual([{ userSlug: 'alice', type: 'visio' }])

            await vi.advanceTimersByTimeAsync(30_000)
            expect(roomsInvitees().filter((room) => room === 'call-2').length).toBeGreaterThan(1)
        })

        it('l\'acceptation tardive de la 1re alerte n\'éteint pas la relance du rappel', async () => {
            const { premiere } = await annulerPuisRappeler()

            await recevoirReponse({
                fromUserSlug: 'alice',
                status: true,
                options: { type: 'visio', room: 'call-1', peerId: 'alice-peer-id', inviteId: premiere },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)

            await vi.advanceTimersByTimeAsync(30_000)
            expect(roomsInvitees().filter((room) => room === 'call-2').length).toBeGreaterThan(1)
        })

        it('le refus tardif ne coupe pas non plus un rappel qui réutilise la même room', async () => {
            // Même clé (alice, call-1, visio) pour les deux invitations : seule l'identité de
            // l'invitation les distingue, sa simple présence ne dit rien.
            const premiere = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await raccrocher()
            await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })

            await recevoirReponse({
                fromUserSlug: 'alice',
                status: false,
                options: { type: 'visio', room: 'call-1', inviteId: premiere },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
            expect(ctx.session.currentCallUsers).toEqual([{ userSlug: 'alice', type: 'visio' }])
        })

        it('un refus valide consomme son invitation, même quand l\'appel survit', async () => {
            // Seul cas où la consommation est observable : avec un dernier participant, le full
            // stop purge l'entrée de toute façon. Le second participant est semé, comme dans
            // `useCallManager.test.js` — un appel direct n'invite qu'un pair à la fois.
            const inviteId = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            ctx.addCurrentCallUser('bob', 'visio')

            await recevoirReponse({
                fromUserSlug: 'alice',
                status: false,
                options: { type: 'visio', room: 'call-1', inviteId },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
            expect(ctx.peerStore.hasWaitingRemotePeerId('alice', 'call-1', 'visio')).toBe(false)
        })

        it('un refus destiné à un autre onglet ne coupe pas l\'appel établi', async () => {
            // Le canal privé de l'appelant porte TOUS ses onglets : le refus adressé à l'invitation
            // d'un autre onglet arrive aussi ici, où l'appel avec alice est déjà établi.
            const inviteId = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await recevoirReponse({
                fromUserSlug: 'alice',
                status: true,
                options: { type: 'visio', room: 'call-1', peerId: 'alice-peer-id', inviteId },
            })
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)

            await recevoirReponse({
                fromUserSlug: 'alice',
                status: false,
                options: { type: 'visio', room: 'call-autre-onglet', inviteId: 'invite-autre-onglet' },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)
            expect(ctx.session.currentCallUsers).toEqual([{ userSlug: 'alice', type: 'visio' }])
        })

        it('un peerId mort n\'efface pas l\'invitation : son refus ferme encore l\'appel', async () => {
            // `peer-unavailable` dans N'IMPORTE QUEL contexte de l'onglet invalide le peerId du
            // pair (`usePeerTransport`) — l'appelé a rechargé son onglet. Son refus, émis par le
            // nouvel onglet que la relance a atteint, porte l'invitation vivante.
            const inviteId = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await vi.advanceTimersByTimeAsync(2_000)
            ctx.peerStore.invalidateRemotePeerId('alice')

            await recevoirReponse({
                fromUserSlug: 'alice',
                status: false,
                options: { type: 'visio', room: 'call-1', inviteId },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('le refus de l\'invitation vivante ferme l\'appel et l\'éteint', async () => {
            const { seconde } = await annulerPuisRappeler()

            await recevoirReponse({
                fromUserSlug: 'alice',
                status: false,
                options: { type: 'visio', room: 'call-2', inviteId: seconde },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
            expect(ctx.peerStore.hasWaitingRemotePeerId('alice', 'call-2', 'visio')).toBe(false)

            const envoisAvant = roomsInvitees().length
            await vi.advanceTimersByTimeAsync(60_000)
            expect(roomsInvitees().length).toBe(envoisAvant)
            expect(ctx.inviteAbandonedSignal.value).toBeNull()
        })
    })

    /**
     * Le verdict que `Notifications.vue` lit pour décider de dire « … est injoignable ».
     *
     * L'invitation sonne sur TOUS les onglets de l'appelé (`sendAlertToUser` diffuse sur son canal
     * privé). Un onglet répond ; les autres sonnent jusqu'à leur auto-refus, qui part avec le MÊME
     * `inviteId`. La FSM l'ignore déjà — mais le toast et `close-call` partaient avant, sans savoir.
     */
    describe('le verdict rendu à Notifications', () => {
        const refusDUnOngletSoeur = (inviteId) => ({
            fromUserSlug: 'alice',
            status: false,
            options: { type: 'visio', room: 'call-1', inviteId },
        })

        it('⭐ appel établi : l\'auto-refus d\'un onglet sœur rend false, et l\'appel continue', async () => {
            const inviteId = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await cm.openCallBetweenPeer({
                fromUserSlug: 'alice',
                status: true,
                options: { type: 'visio', room: 'call-1', peerId: 'alice-peer-id', inviteId },
            })
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)

            const verdict = await cm.openCallBetweenPeer(refusDUnOngletSoeur(inviteId))

            expect(verdict).toBe(false)
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)
        })

        it('⭐ l\'appelé a accepté puis annulé : l\'auto-refus d\'un onglet sœur rend false', async () => {
            // Son signal de fin d'appel arrive seul (`flux.md`, « L'appelé qui accepte puis annule ») :
            // un départ, qui ramène l'appelant à IDLE par l'arrêt complet.
            const inviteId = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await cm.remoteStopCall({ fromUserSlug: 'alice', room: 'call-1', type: 'visio' })
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)

            const verdict = await cm.openCallBetweenPeer(refusDUnOngletSoeur(inviteId))

            expect(verdict).toBe(false)
        })

        it('le refus de l\'invitation en vol rend true', async () => {
            const inviteId = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })

            expect(await cm.openCallBetweenPeer(refusDUnOngletSoeur(inviteId))).toBe(true)
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('un refus SANS inviteId garde l\'ancien sens, donc rend true', async () => {
            // Appelé sur un bundle antérieur, ou les deux reprises internes : ils portent par
            // construction sur l'invitation vivante.
            await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })

            expect(await cm.openCallBetweenPeer({
                fromUserSlug: 'alice',
                status: false,
                options: { type: 'visio' },
            })).toBe(true)
        })

        it('une acceptation rend true si elle vaut pour l\'invitation en vol, false sinon', async () => {
            const inviteId = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            const acceptation = {
                fromUserSlug: 'alice',
                status: true,
                options: { type: 'visio', room: 'call-1', peerId: 'alice-peer-id', inviteId },
            }

            expect(await cm.openCallBetweenPeer(acceptation)).toBe(true)
            // La même acceptation, une seconde fois : plus rien n'est en vol.
            expect(await cm.openCallBetweenPeer(acceptation)).toBe(false)
        })
    })

    /**
     * Le signal de fin d'appel (`.CloseConnectionToPeerID` → `remoteStopCall`) porte la room de
     * l'appel que son émetteur ferme. Des raccrochés croisés suivis d'un rappel immédiat le font
     * arriver pendant l'appel SUIVANT avec le même pair : il ne parle pas de celui-là.
     */
    describe('un départ ne vaut que pour SON appel', () => {
        const raccrocher = () => cm.stopCallWithPeers([...ctx.session.currentCallUsers], true, { mode: 'full' })

        const departDAlice = (room) => cm.remoteStopCall({ fromUserSlug: 'alice', room, type: 'visio' })

        const appelEtabli = async (room) => {
            const inviteId = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room })
            await cm.openCallBetweenPeer({
                fromUserSlug: 'alice',
                status: true,
                options: { type: 'visio', room, peerId: 'alice-peer-id', inviteId },
            })
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)
        }

        it('⭐ en `calling`, le départ qui porte la room de l\'appel précédent ne coupe pas le rappel', async () => {
            await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await raccrocher()
            await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-2' })

            await departDAlice('call-1')

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
            expect(ctx.session.currentCallUsers).toEqual([{ userSlug: 'alice', type: 'visio' }])

            await vi.advanceTimersByTimeAsync(30_000)
            expect(roomsInvitees().filter((room) => room === 'call-2').length).toBeGreaterThan(1)
        })

        it('⭐ appel établi : le départ qui porte la room d\'un autre appel ne le coupe pas', async () => {
            await appelEtabli('call-2')

            await departDAlice('call-1')

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)
            expect(ctx.session.currentCallUsers).toEqual([{ userSlug: 'alice', type: 'visio' }])
            // L'allowlist aussi : la séquence de départ la vide pour le pair qui s'en va.
            expect(ctx.isAuthorizedCallPeer('alice')).toBe(true)
        })

        it('le départ qui porte la room de l\'appel courant le ferme', async () => {
            await appelEtabli('call-1')

            await departDAlice('call-1')

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
            expect(ctx.isAuthorizedCallPeer('alice')).toBe(false)
        })

        it('un départ SANS room garde l\'ancien sens : il vaut pour l\'appel courant', async () => {
            await appelEtabli('call-1')

            await cm.remoteStopCall({ fromUserSlug: 'alice', type: 'visio' })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('la séquence elle-même, appelée sans room, vaut aussi pour l\'appel courant', async () => {
            // Les deux déclencheurs complètent la room par celle de l'appel : ce cas garde un
            // troisième, qui ne le ferait pas, d'un départ jeté — un pair parti resté dans l'appel
            // ET dans l'allowlist, ce qui rend le garde sortant permissif à son profit.
            await appelEtabli('call-1')

            expect(await cm.handleRemoteDeparture({ userSlug: 'alice', type: 'visio' })).toBe(true)
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })
    })
})
