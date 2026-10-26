/**
 * Notifications.alerts.test.js — le joint entre `.AlertToUser` et le moteur d'appel
 *
 * `AlertComponent` est un convertisseur d'événement ; `Notifications` est l'adaptateur qui détient
 * l'API de `useMediaBroadcast`. Le même partage que `CallManagerBtn` (présentation) /
 * `Notifications` (adaptateur) — et, comme là-bas, **ce qui n'est testable qu'ici est la
 * COUTURE** : l'écouteur Reverb qui pose l'alerte, les props qu'il lui passe, l'attribut
 * `@response-alert` du template, et le verbe atteint. Aucun de ces quatre faits ne rougit un cas
 * d'`AlertComponent.test.js`, qui monte le composant directement.
 *
 * ⚠️ **Troisième fichier sur `Notifications.vue`, et c'est encore la mesure qui l'impose.**
 * `.AlertToUser` et `onResponseAlert` n'étaient couverts NULLE PART : `Notifications.test.js`
 * couvre `.ResponseToAuthorizationPeer`, `call-user` et l'abandon du retry ;
 * `Notifications.callControls.test.js` couvre les quatre attributs de `CallManagerBtn`. Et le
 * harnais n'est pas le même que le leur — celui-ci doit résoudre **deux niveaux** de composant
 * asynchrone et traverser un **Teleport**.
 *
 * ⚠️ **DOUBLE niveau d'asynchrone** : `Notifications` → `AlertComponent` → l'alerte. Le second
 * `import()` ne PART qu'après le rendu du premier, donc l'attente doit repasser par le
 * renderer entre les deux. Mesuré (contrôles n° 9 à 11) : `dynamicImportSettled` + `nextTick`,
 * répétés une fois, suffisent et sont nécessaires — et ici, contrairement au fichier unitaire,
 * **`flushPromises` ne les remplace pas**, ce qui confirme la mesure du voisin.
 *
 * ⚠️ **Le Teleport sort du wrapper.** `mount()` n'attache pas son conteneur au document, mais le
 * `<Teleport to="body">` de `Notifications.vue:2` livre quand même dans le vrai `document.body`.
 * Conséquence mesurée : `wrapper.find('.btn-success')` rend **false** et `wrapper.html()` ne
 * montre rien de l'alerte. Ce qui traverse est `findComponent` (`findAllVNodes` descend dans les
 * `children` du vnode Teleport) — et `document.body.querySelector`, qui prouve en plus que
 * l'`id="notification-component-wrapper"` descend par DEUX fallthrough successifs jusqu'au
 * `<div class="alert">`. Le premier cas asserte les trois faits ensemble ; un fichier qui les
 * ignorerait chercherait ses boutons par `wrapper.find` et écrirait des négatives vraies par
 * vacuité.
 *
 * ⚠️ `callStatus` est mis à `'idle'` en `beforeEach` : c'est l'état réel quand une invitation
 * ARRIVE, et ça garde `CallManagerBtn` (le second composant asynchrone du template) hors du
 * montage — donc pas de stub `Spinner`, et un seul chemin asynchrone à drainer.
 *
 * ℹ️ **Ce fichier tourne sous timers RÉELS, et c'est sans conséquence depuis B2** : le démontage
 * annule l'auto-refus des alertes, donc aucun minuteur d'un cas antérieur ne peut plus produire ici
 * un `acceptCallFromPeer` FANTÔME pendant un cas ultérieur. Une borne de durée chiffrée vivait ici
 * tant que ce n'était pas vrai ; elle est partie avec sa cause. Les minuteurs eux-mêmes se testent
 * sous horloge factice, dans `AlertComponent.timers.test.js`.
 *
 * ── CE QUE CE FICHIER A ÉPINGLÉ : B1, fermé le 2026-08-31 ─────────────────────
 * Écrit rouge d'un cas — le symptôme, à l'altitude où c'en est un : « accepter un appel VOCAL
 * entrant ne fait rien ». `AudioCallAlert` émettait `response-call`, personne ne l'écoutait,
 * `acceptCallFromPeer` n'était jamais atteint, l'alerte restait à l'écran et l'appelant attendait
 * l'abandon du moteur de retry (« bob n'a pas répondu »). **Le partage vaut d'être gardé** : la
 * CAUSE est nommée par le cas de vocabulaire d'`AlertComponent.test.js`, l'EFFET est ici — un seul
 * défaut, deux altitudes, et c'est ce qui a fait que le diagnostic n'a pas eu à être cherché.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 * ⚠️ **Mesurés AVANT B1, quand la référence n'était pas verte** : rouges TOTAUX du fichier sous
 * mutation, la référence en portant **1 ici** (le rouge de B1) · **3** dans
 * `AlertComponent.test.js` (les siens) · **0** dans `Notifications.test.js` et
 * `Notifications.callControls.test.js`. Elle est verte depuis B1, mais **on ne les convertit pas en
 * écarts par soustraction** : le n° 1 du fichier unitaire le prouve — sa mutation rougissait des cas
 * que B1 rendait verts. Chaque conversion demande la mesure ; dette assumée, à reprendre au lot C,
 * qui déplace les deux alertes.
 * Colonnes : ce fichier · unitaire · câblage · callControls. Les numéros de ligne sont ceux du
 * 2026-10-26 (B3-B5 les ont décalés) ; les chiffres restent ceux du 2026-08-31.
 *
 * LA COUTURE — mutations dans `Notifications.vue` :
 *    1. `@response-alert="onResponseAlert"` retiré (l. 9) ......... 4 · 3 · 0 · 0
 *    2. `v-bind="notificationComponentProps"` retiré (l. 8) ....... 7 · 3 · 0 · 0
 *    3. `notificationComponent.value = AlertComponent` (l. 133) ... 7 · 3 · 0 · 0
 *    4. garde `isInviteDuplicate` retirée (l. 121) ................ 2 · 3 · 0 · 0
 *    5. `notificationComponent.value = null` retiré (l. 265) ...... 2 · 3 · 0 · 0
 *    6. `case 'peer-access-permission'` renommé (l. 272) .......... 3 · 3 · 0 · 0
 *    7. `props.value = event` → `event.options` seul .............. 7 · 3 · 0 · 0
 *    8. `options: { ...options }` → même référence (l. 275) ....... 1 · 3 · 0 · 0   ← 0 écart
 *
 * LE HARNAIS — l'attente du double niveau d'asynchrone :
 *    9. l'attente réduite à ZÉRO tour (`nextTick` seul) .......... 7
 *   10. l'attente réduite à UN tour (l'état livré) ............... 1   ← 0 écart
 *   11. `flushPromises` ×4 au lieu de `dynamicImportSettled` ..... 3
 *
 * ⭐ **LE CHIFFRE QUI VAUT CE FICHIER : les huit contrôles de couture rougissent ici, et ZÉRO cas
 * des trois autres fichiers.** L'alerte peut cesser entièrement d'être posée, de recevoir ses
 * props, ou d'être écoutée — l'invitation d'appel entrant peut devenir un écran mort — sans qu'un
 * seul cas de l'étage unitaire ni des deux autres fichiers de ce composant bouge. C'est la mesure
 * qui interdit de se contenter du fichier unitaire, et elle est la même que celle qui a imposé
 * `Notifications.callControls.test.js`.
 *
 * ⚠️ **La réciproque n'est pas vraie, et il faut le dire** : les mutations d'`AlertComponent.vue`
 * rougissent les DEUX fichiers (10 · 7 pour le mapping croisé, 11 · 7 pour un `created()` vidé),
 * parce que ce fichier monte le composant réel. Ce n'est pas une redondance à supprimer : ici
 * elles rougissent PAR le symptôme utilisateur (« le verbe n'est pas atteint », « l'alerte reste
 * à l'écran »), là-bas par la conversion d'événement. Deux altitudes, deux diagnostics.
 *
 * **Les deux 0, avec leur raison** :
 *
 * • **n° 8** : la copie défensive d'`options` n'est observable que si quelqu'un mute l'objet
 *   ensuite, et personne ne le fait. Écrire ce cas serait tester l'implémentation, pas un fait
 *   métier — la ligne reste (elle protège l'objet de l'événement Reverb, que d'autres écouteurs
 *   pourraient lire), et le 0 est noté pour ne pas être re-mesuré.
 * • **n° 10** : le second tour d'attente, écrit d'abord par prudence, ne rougissait rien de plus.
 *   **Il a été retiré** — c'est l'état livré du fichier, donc ce 0 est la mesure de ce qui n'est
 *   plus là. `dynamicImportSettled` est récursif : il voit naître le second `import()`.
 *
 * ── CE QUE CE FICHIER A ÉPINGLÉ : B3, B4, B5, fermés le 2026-10-26 ─────────────
 * Écrits rouges de quatre cas — ceux marqués B3, B4, et les deux ⭐ de B5 —, verts au correctif sans
 * qu'une assertion change. Les deux autres cas de B5 sont nés VERTS, et c'est voulu : ils gardent
 * les deux façons fausses d'écrire le garde, qui n'existait pas encore. Leur mesure est M2 et M3.
 *
 * • **B5 — occupé ⇒ refus** (décision de David). Une invitation reçue pendant qu'une alerte attend
 *   la réponse d'un AUTRE appelant est refusée d'office, avec un toast. Avant, Vue patchait l'alerte
 *   vivante : « Appel video de carole » sur l'alerte de Bob, et le minuteur armé pour Bob refusait
 *   Carole à sa place. Le même compte n'est pas refusé — un client sans `inviteId`, un second
 *   onglet : la raison est dans le docblock d'`isAwaitingAnotherCaller`.
 * • **B3 — une invitation qu'aucune alerte ne sait afficher se refuse d'office.** Mesuré avant le
 *   correctif : après une invitation `screen`, l'appel suivant de Carole était INVISIBLE — l'alerte
 *   vide gardait le créneau. Avec le garde de B5 seul, il aurait été refusé : B5 sans B3 changeait
 *   un défaut silencieux en refus systématique. ⚠️ **La relecture a trouvé le même trou là où l'alerte
 *   ne PEUT pas s'afficher** — chunk rejeté ou pendu : `*.loadError.test.js`, un fichier par niveau.
 * • **B4 — `notificationComponent` est un `shallowRef`.** Un `ref` profond enveloppait le composant
 *   dans un proxy réactif, et Vue le signalait à chaque montage réel d'alerte, production comprise.
 *
 * ── CONTRÔLES DE B3, B4, B5, mesurés le 2026-10-26 ────────────────────────────
 * Rouges sous mutation, sur une référence verte, sur les sept fichiers de `System/__tests__`.
 * Colonnes : ce fichier · unitaire · timers · câblage · callControls · `AlertComponent.loadError` ·
 * `Notifications.alerts.loadError`. Les contrôles des deux pannes de chunk sont dans leurs fichiers.
 *
 *    M1. garde « occupé » neutralisée (`return false`) .......... 2 · 0 · 0 · 0 · 0 · 0 · 0
 *    M2. comparaison d'appelant retirée ......................... 1 · 0 · 0 · 0 · 0 · 0 · 0
 *    M3. « occupé » lu sur les props, pas sur le composant ...... 2 · 0 · 0 · 0 · 0 · 0 · 1
 *    M4. toast du refus d'office retiré ......................... 1 · 0 · 0 · 0 · 0 · 0 · 0
 *    M5. refus d'office retiré (B5) ............................. 1 · 0 · 0 · 0 · 0 · 0 · 0
 *    M6. `shallowRef` → `ref` (B4) .............................. 1 · 0 · 0 · 0 · 0 · 0 · 0
 *    M7. auto-refus d'`AlertComponent` retiré (B3) .............. 1 · 2 · 0 · 0 · 0 · 0 · 0
 *    M8. `console.warn` du repli retiré (B3) .................... 0 · 2 · 0 · 0 · 0 · 0 · 0
 *    M9. chaînage optionnel retiré (B3) ......................... 0 · 1 · 0 · 0 · 0 · 0 · 0
 *
 * Aucun 0 en tête de ligne sur le fichier qui porte le cas. M3 vaut d'être lu : les props ne sont
 * jamais remises à `null`, donc un garde qui les lirait refuserait tout appelant après le premier
 * — c'est le cas « répondre libère l'écran » qui le voit, celui de B3, et la panne de chunk.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createCallPeersDouble, VERBES_APPEL } from './helpers/createCallPeersDouble.js'

// ─── Doubles ─────────────────────────────────────────────────────────────────

/** Écouteurs Reverb enregistrés par le composant, indexés par nom d'événement. */
let reverbListeners = {}

// Le double et ses cinq fidélités vivent dans le helper, partagé avec les deux autres fichiers
// de ce composant : une seule liste à tenir pour les trois.
const peers = createCallPeersDouble()
const peersDouble = peers.api

vi.mock('~socializer/components/WebRTC2/Composables/useMediaBroadcast.js', () => ({
    useMediaBroadcast: () => peersDouble,
}))

vi.mock('~socializer/components/System/composables/useReverbChannel.js', () => ({
    useReverbChannel: (_channel, options = {}) => {
        reverbListeners = options.listeners ?? {}
        return { whisper: vi.fn(() => true), leave: vi.fn() }
    },
}))

// Les stores sont mockés en vrais stores Pinia : `storeToRefs` n'accepte rien d'autre.
vi.mock('~estarter/stores/me.js', async () => {
    const { defineStore } = await import('pinia')
    return {
        useMeStore: defineStore('me', {
            state: () => ({ me: { id: 1, slug: 'alice', channel: 'App.Models.User.1' } }),
            getters: { getMe: (state) => state.me },
            actions: { addUnreadNotifications() {} },
        }),
    }
})

vi.mock('~socializer/stores/peers2.js', async () => {
    const { defineStore } = await import('pinia')
    return { usePeer2Store: defineStore('peers2', { actions: { dispatchSignal() {} } }) }
})

vi.mock('~socializer/stores/conversations.js', async () => {
    const { defineStore } = await import('pinia')
    return {
        useConversationsStore: defineStore('conversations', { actions: { addConversation() {} } }),
    }
})

import Notifications from '~socializer/components/System/Notifications.vue'

// ─── Harnais ─────────────────────────────────────────────────────────────────

const eventBus = { $emit: vi.fn(), $on: vi.fn(), $off: vi.fn() }

/** L'invitation telle que `.AlertToUser` la diffuse : cinq clés d'options, et `fromUserSlug`. */
const invitationEntrante = (type, inviteId = 'invite-1', fromUserSlug = 'bob') => ({
    fromUserSlug,
    options: {
        type,
        action: 'peer-access-permission',
        room: 'call-room-1',
        peerId: '00000000-0000-4000-8000-000000000001',
        inviteId,
    },
})

const monter = async () => {
    const w = mount(Notifications, { global: { provide: { eventBus } } })
    await vi.dynamicImportSettled()
    return w
}

/**
 * Reçoit l'invitation et attend que les DEUX niveaux d'asynchrone soient résolus : le second
 * `import()` ne part qu'après le rendu du premier composant.
 *
 * ⚠️ **Un seul tour suffit, et c'est mesuré, pas supposé** (contrôles n° 9 à 11) :
 * `dynamicImportSettled` est récursif et repasse par une macrotâche à chaque tour, donc il voit
 * naître le second niveau. Un second tour, écrit d'abord par prudence, rougissait **0 cas** de
 * plus : il a été retiré. Zéro tour, en revanche, rougit 7 cas sur 9.
 */
const recevoirLInvitation = async (type, inviteId = 'invite-1', fromUserSlug = 'bob') => {
    reverbListeners['.AlertToUser'](invitationEntrante(type, inviteId, fromUserSlug))
    await nextTick()
    await vi.dynamicImportSettled()
    await nextTick()
}

/** L'alerte, atteinte par le VDOM : `wrapper.find` ne traverse pas le Teleport. */
const alerte = (w, nom = 'AlertComponent') => w.findComponent({ name: nom })

const accepter = (w) => alerte(w).find('.btn-success')
const refuser = (w) => alerte(w).find('.btn-danger')

/** La même chose par le DOM réel : prouve en plus la descente de l'`id` du `<component>`. */
const boutonDansLeBody = (classe) =>
    document.body.querySelector(`#notification-component-wrapper .${classe}`)

let wrapper
let espionWarn

beforeEach(() => {
    vi.clearAllMocks()
    reverbListeners = {}
    window.AWN = { info: vi.fn(), alert: vi.fn() }
    // `clearAllMocks` ne touche ni un `ref` ni un `reactive` : il ne remet à zéro que des
    // compteurs d'appels. D'où `reinitialiser()`, AVANT le montage.
    peers.reinitialiser()
    // L'état réel à l'arrivée d'une invitation — et il garde `CallManagerBtn` hors du montage.
    peers.statutAppel.value = 'idle'
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    espionWarn?.mockRestore()
    espionWarn = undefined
    delete window.AWN
    // Hygiène de Teleport : les nœuds livrés dans `body` ne sont pas emportés par le
    // remplacement du conteneur de montage. Le démontage les retire — ce garde-fou rend visible
    // le jour où il ne le ferait plus, au lieu de laisser une alerte fantôme au cas suivant.
    expect(document.body.querySelector('.alert')).toBeNull()
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Notifications — .AlertToUser, l\'invitation d\'appel affichée', () => {

    it('⭐ l\'alerte est montée dans le body, hors du wrapper — le garde-fou de tout ce fichier', async () => {
        wrapper = await monter()

        await recevoirLInvitation('visio')

        expect(alerte(wrapper).exists()).toBe(true)
        expect(alerte(wrapper, 'VideoCallAlert').exists()).toBe(true)
        expect(alerte(wrapper).findAll('button')).toHaveLength(2)

        // Le fait Teleport, épinglé UNE fois pour tout le fichier : l'alerte vit dans
        // `document.body`, pas dans le conteneur de montage — et l'`id` posé sur le
        // `<component>` descend jusqu'à la racine de l'alerte par deux fallthrough.
        expect(boutonDansLeBody('btn-success')).not.toBeNull()
        expect(wrapper.find('.btn-success').exists()).toBe(false)
    })

    it('aucune alerte n\'est affichée avant qu\'une invitation n\'arrive', async () => {
        wrapper = await monter()

        expect(alerte(wrapper).exists()).toBe(false)
        expect(document.body.querySelector('#notification-component-wrapper')).toBeNull()
    })

    it('une invitation en DOUBLE n\'affiche pas une seconde alerte', async () => {
        wrapper = await monter()
        peersDouble.isInviteDuplicate.mockReturnValueOnce(true)

        await recevoirLInvitation('visio')

        // La garde est en TÊTE de l'écouteur : un doublon ne doit pas repeindre une alerte
        // par-dessus celle qui attend déjà une réponse, ni en poser une après que l'appel a
        // été accepté. Le paquet en a deux, `inviteId` et `seenInvites` ; c'est celle-ci qui
        // protège l'écran.
        expect(alerte(wrapper).exists()).toBe(false)
        expect(peersDouble.isInviteDuplicate).toHaveBeenCalledWith('invite-1')
    })

    it('l\'alerte affiche le slug de l\'appelant tel que le backend l\'a diffusé', async () => {
        wrapper = await monter()

        await recevoirLInvitation('visio')

        // Preuve que `v-bind="notificationComponentProps"` relaie bien l'objet reçu ENTIER :
        // le slug ne vient pas d'un store, il n'existe que dans l'événement Reverb.
        expect(alerte(wrapper, 'VideoCallAlert').text()).toContain('bob')
    })

    it('poser l\'alerte ne fait pas avertir Vue d\'un composant rendu réactif (B4)', async () => {
        // Un composant porté par un `ref` profond est enveloppé dans un proxy réactif : Vue le
        // signale à chaque montage réel d'alerte — donc en production aussi, pas en test seulement.
        espionWarn = vi.spyOn(console, 'warn')
        wrapper = await monter()

        await recevoirLInvitation('visio')

        expect(alerte(wrapper).exists()).toBe(true)
        const avertissementsReactifs = espionWarn.mock.calls
            .map(([message]) => String(message))
            .filter((message) => message.includes('made a reactive object'))
        expect(avertissementsReactifs).toEqual([])
    })

    describe('répondre à l\'invitation', () => {

        it('⭐ « Accepter » demande l\'ouverture de l\'appel au moteur, avec les options reçues', async () => {
            wrapper = await monter()
            await recevoirLInvitation('visio')

            await accepter(wrapper).trigger('click')
            await flushPromises()

            expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledTimes(1)
            expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledWith({
                fromUserSlug: 'bob',
                options: invitationEntrante('visio').options,
                status: true,
            })
        })

        it('⭐ « Refuser » passe par le MÊME verbe, avec status false', async () => {
            wrapper = await monter()
            await recevoirLInvitation('visio')

            await refuser(wrapper).trigger('click')
            await flushPromises()

            // Un refus n'est pas un chemin séparé : c'est le même appel avec `false`. C'est sa
            // branche `!status` en aval qui retire le participant et ramène la FSM à IDLE.
            expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledWith({
                fromUserSlug: 'bob',
                options: invitationEntrante('visio').options,
                status: false,
            })
            // L'assertion négative sur le reste de l'API : seule elle rend visible un câblage
            // croisé vers un verbe voisin — `openCallBetweenPeer` a la même forme d'argument.
            for (const verbe of VERBES_APPEL.filter((v) => v !== 'acceptCallFromPeer')) {
                expect(peersDouble[verbe]).not.toHaveBeenCalled()
            }
        })

        it('⭐ répondre fait disparaître l\'alerte de l\'écran', async () => {
            wrapper = await monter()
            await recevoirLInvitation('visio')

            await accepter(wrapper).trigger('click')
            await flushPromises()

            // Sans cette remise à `null`, l'alerte resterait affichée par-dessus l'appel qu'on
            // vient d'accepter — et ses deux boutons resteraient cliquables.
            expect(alerte(wrapper).exists()).toBe(false)
            expect(document.body.querySelector('.alert')).toBeNull()
        })

        it('une seconde invitation réaffiche une alerte : répondre n\'éteint pas le canal', async () => {
            // Ce cas passe par `notificationComponent.value = null` (on a répondu). Une seconde
            // invitation reçue SANS avoir répondu est l'affaire du `describe` de B5, plus bas.
            wrapper = await monter()
            await recevoirLInvitation('visio')
            await accepter(wrapper).trigger('click')
            await flushPromises()

            await recevoirLInvitation('visio', 'invite-2')

            expect(alerte(wrapper).exists()).toBe(true)
            expect(alerte(wrapper, 'VideoCallAlert').exists()).toBe(true)
        })
    })

    describe('un appel VOCAL entrant — ce que B1 a fermé', () => {

        it('⭐ « Accepter » un appel VOCAL demande l\'ouverture de l\'appel au moteur', async () => {
            wrapper = await monter()
            await recevoirLInvitation('vocal')

            // Garde-fou d'abord : l'alerte vocale est bien là, et son bouton aussi. C'est ce qui a
            // fait que le rouge de ce cas disait « le verbe n'est pas atteint », et jamais « le
            // bouton n'a pas été trouvé » — la distinction entre le défaut B1 et un harnais cassé.
            expect(alerte(wrapper, 'AudioCallAlert').exists()).toBe(true)
            expect(accepter(wrapper).exists()).toBe(true)

            await accepter(wrapper).trigger('click')
            await flushPromises()

            expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledWith({
                fromUserSlug: 'bob',
                options: invitationEntrante('vocal').options,
                status: true,
            })
        })
    })

    describe('une seconde invitation pendant qu\'une alerte attend — B5 : occupé ⇒ refus', () => {

        it('⭐ un AUTRE appelant est refusé d\'office, et l\'alerte affichée ne bouge pas', async () => {
            wrapper = await monter()
            await recevoirLInvitation('visio', 'invite-1', 'bob')

            await recevoirLInvitation('vocal', 'invite-2', 'carole')
            await flushPromises()

            // L'écran reste celui de Bob, en entier : le type d'alerte ET le nom. Avant B5, Vue
            // patchait l'instance vivante — l'alerte vidéo affichait « carole », et l'auto-refus
            // armé pour Bob tirait sur les options de Carole.
            expect(alerte(wrapper, 'VideoCallAlert').exists()).toBe(true)
            expect(alerte(wrapper, 'AudioCallAlert').exists()).toBe(false)
            expect(alerte(wrapper, 'VideoCallAlert').text()).toContain('bob')
            expect(alerte(wrapper, 'VideoCallAlert').text()).not.toContain('carole')

            // Carole reçoit un refus EXPLICITE, par le verbe d'un clic sur « Refuser » : son moteur
            // de retry s'arrête et sa FSM revient à IDLE tout de suite, au lieu d'attendre
            // l'abandon du retry.
            expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledTimes(1)
            expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledWith({
                fromUserSlug: 'carole',
                options: invitationEntrante('vocal', 'invite-2', 'carole').options,
                status: false,
            })
            expect(window.AWN.info).toHaveBeenCalledWith(expect.stringContaining('carole'))
        })

        it('⭐ l\'alerte affichée répond toujours pour SON appelant', async () => {
            wrapper = await monter()
            await recevoirLInvitation('visio', 'invite-1', 'bob')
            await recevoirLInvitation('vocal', 'invite-2', 'carole')
            await flushPromises()

            await accepter(wrapper).trigger('click')
            await flushPromises()

            expect(peersDouble.acceptCallFromPeer).toHaveBeenLastCalledWith({
                fromUserSlug: 'bob',
                options: invitationEntrante('visio', 'invite-1', 'bob').options,
                status: true,
            })
        })

        it('une ré-émission du MÊME appelant n\'est pas refusée, même sans inviteId', async () => {
            // Une relance du moteur de retry réutilise son `inviteId` et `isInviteDuplicate` l'élimine
            // avant le garde. Ce cas prend ce qui lui échappe : un client sans `inviteId`, que le
            // serveur accepte (`nullable`) et pour lequel `isInviteDuplicate(null)` rend faux. Un
            // second onglet du même compte, avec un id neuf, passe par la même comparaison.
            wrapper = await monter()
            await recevoirLInvitation('visio', null, 'bob')

            await recevoirLInvitation('visio', null, 'bob')
            await flushPromises()

            expect(peersDouble.acceptCallFromPeer).not.toHaveBeenCalled()
            expect(alerte(wrapper, 'VideoCallAlert').exists()).toBe(true)
        })

        it('répondre libère l\'écran : l\'appelant suivant est affiché, pas refusé', async () => {
            wrapper = await monter()
            await recevoirLInvitation('visio', 'invite-1', 'bob')
            await refuser(wrapper).trigger('click')
            await flushPromises()

            await recevoirLInvitation('vocal', 'invite-2', 'carole')

            // Remonté, et non patché : c'est l'alerte VOCALE qui s'affiche. Un seul appel au
            // verbe — le refus de Bob, par le clic ; aucun pour Carole.
            expect(alerte(wrapper, 'AudioCallAlert').exists()).toBe(true)
            expect(alerte(wrapper, 'AudioCallAlert').text()).toContain('carole')
            expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledTimes(1)
        })
    })

    describe('une invitation qu\'aucune alerte ne sait afficher — B3', () => {

        it('⭐ elle est refusée d\'office et ne garde pas l\'écran : l\'appel suivant s\'affiche', async () => {
            // `screen` passe la validation du backend, et `mappingComponents` ne le connaît pas.
            // Avant B3, l'alerte invisible GARDAIT le créneau, et l'invitation suivante patchait
            // une instance dont `currentComponent` restait vide : tous les appels suivants
            // devenaient invisibles. Avec le garde de B5 et sans B3, ils seraient tous refusés.
            espionWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            wrapper = await monter()

            await recevoirLInvitation('screen', 'invite-1', 'bob')
            await flushPromises()

            expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledWith({
                fromUserSlug: 'bob',
                options: invitationEntrante('screen', 'invite-1', 'bob').options,
                status: false,
            })

            await recevoirLInvitation('visio', 'invite-2', 'carole')

            expect(alerte(wrapper, 'VideoCallAlert').exists()).toBe(true)
            expect(alerte(wrapper, 'VideoCallAlert').text()).toContain('carole')
            expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledTimes(1)
        })
    })
})
