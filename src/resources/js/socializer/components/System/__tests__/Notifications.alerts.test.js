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
 * ⚠️ **La DURÉE de ce fichier est une borne de correction** : 1,2 s au 2026-08-31 (259 ms de
 * tests, les deux fichiers d'alertes ensemble). Le `setTimeout` d'auto-refus des alertes n'est pas
 * annulé au démontage (défaut B2) ; au-delà de 10 s de temps mur, le timer d'un cas antérieur
 * produirait ici un `acceptCallFromPeer` FANTÔME pendant un cas ultérieur. C'est le défaut B2 vu
 * depuis le harnais — **et B1 l'a armé sur la branche vocale** : le timer d'`AudioCallAlert`
 * émettait dans le vide, il émet désormais un vrai refus. Les deux alertes sont concernées.
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
 * Colonnes : ce fichier · unitaire · câblage · callControls.
 *
 * LA COUTURE — mutations dans `Notifications.vue` :
 *    1. `@response-alert="onResponseAlert"` retiré (l. 9) ......... 4 · 3 · 0 · 0
 *    2. `v-bind="notificationComponentProps"` retiré (l. 8) ....... 7 · 3 · 0 · 0
 *    3. `notificationComponent.value = AlertComponent` (l. 93) .... 7 · 3 · 0 · 0
 *    4. garde `isInviteDuplicate` retirée (l. 91) ................. 2 · 3 · 0 · 0
 *    5. `notificationComponent.value = null` retiré (l. 205) ...... 2 · 3 · 0 · 0
 *    6. `case 'peer-access-permission'` renommé (l. 207) .......... 3 · 3 · 0 · 0
 *    7. `props.value = event` → `event.options` seul .............. 7 · 3 · 0 · 0
 *    8. `options: { ...options }` → même référence (l. 210) ....... 1 · 3 · 0 · 0   ← 0 écart
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
 * ⚠️ **Warning Vue observé au montage réel, et il vient de la PRODUCTION** : « Vue received a
 * Component that was made a reactive object » — `notificationComponent` est un `ref` qui porte un
 * composant (`Notifications.vue:68`), là où `shallowRef` / `markRaw` est attendu. Aucun test ne
 * le provoque : il apparaît dès qu'une alerte est réellement montée, donc en production aussi.
 * Nommé, pas corrigé — item ouvert de `work/doc-rustines.md` (lot 1, B4).
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
const invitationEntrante = (type, inviteId = 'invite-1') => ({
    fromUserSlug: 'bob',
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
const recevoirLInvitation = async (type, inviteId = 'invite-1') => {
    reverbListeners['.AlertToUser'](invitationEntrante(type, inviteId))
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
})
