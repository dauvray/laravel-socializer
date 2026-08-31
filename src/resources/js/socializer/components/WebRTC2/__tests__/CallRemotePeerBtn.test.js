/**
 * CallRemotePeerBtn.test.js
 *
 * Le bouton d'appel du mur d'un utilisateur. Il ne parle à personne directement : il pose une
 * invitation sur l'eventBus global, s'arme, et attend un `close-call` qui le nomme pour se
 * rendre à l'utilisateur.
 *
 * Sa présence dans `Cover.vue` était déjà épinglée (`User/__tests__/coverCallButton.test.js`),
 * mais en `shallow` — donc son COMPORTEMENT ne l'était nulle part. Le commentaire de ce
 * fichier-là dit pourquoi : « c'est ce qui évite d'avoir à fournir les `inject` de
 * CallRemotePeerBtn ». Ici on les fournit.
 *
 * ⚠️ Les deux `inject` étaient NUS avant ce lot (`AWN` et `eventBus`), et les deux sont traités
 * différemment — ce n'est pas une incohérence, c'est la différence entre un ornement et une
 * dépendance :
 *
 *   - **`AWN` dégrade** (convention du lot B) : `inject('AWN', null)` + repli `window.AWN`,
 *     appel optionnel. Le défaut suivait celui de `GroupLocalStreamBtn.vue:44`, mais le gain
 *     réel n'est pas là : c'est que `AWN.info(...)` était appelé **entre** l'émission et
 *     l'écriture d'état. Sur une page sans notifieur, l'invitation partait et le bouton
 *     restait ACTIF — l'utilisateur pouvait la renvoyer en boucle, la `TypeError` étant avalée
 *     par `callWithErrorHandling` de Vue. Épinglé ci-dessous.
 *   - **`eventBus` échoue visiblement** : le bus EST la fonctionnalité, `onCallUser` n'a aucun
 *     autre canal. Un no-op silencieux (le motif de `createPeerContext.js:95-102`, qui est le
 *     bon geste pour un CONTEXTE) produirait ici un bouton qui accepte le clic, se désactive
 *     et n'envoie rien — exactement ce que son propre consommateur condamne : « un bouton qui
 *     ne fait rien est pire que pas de bouton » (`Cover.vue:29-32`). Le bouton l'avoue donc :
 *     il se désactive, et le dit une fois en console.
 *
 * ⚠️ FAIT DE HARNAIS, mesuré : **`trigger` de VTU ne dispatche PAS sur un `<button>` portant
 * l'attribut `disabled`** (`@vue/test-utils/dist/vue-test-utils.cjs.js:7228`, et `isDisabled()`
 * l.7060-7072 qui lit l'ATTRIBUT, sur une liste de balises dont `BUTTON`). Deux conséquences :
 * l'armement s'asserte par `attributes('disabled')` et non par une propriété — l'inverse du
 * piège `muted`, où c'est la propriété qui compte —, et un cas de « second clic » mesure
 * l'émulation du navigateur par VTU autant que le composant. C'est acceptable ici : un vrai
 * navigateur ferme au même endroit.
 *
 * ⚠️ `window.AWN` n'est JAMAIS posé dans ce fichier. Le repli doit rester non exercé, sinon le
 * cas « sans aucun notifieur » ne mesure rien.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 * Référence relue verte avant chaque mutation : 16 cas.
 *
 *    1. `eventBus.$emit('call-user', …)` retiré ........................... 5 cas
 *    2. les deux arguments de `$emit` permutés ............................ 2 cas
 *    3. `isInCall.value = true` retiré ................................... 8 cas
 *    4. `:disabled` réduit à `isInCall` (garde du bus ôtée du rendu) ...... 2 cas
 *    5. `:disabled` retiré entièrement ................................... 10 cas
 *    6. `callIcon` figé sur la branche visio .............................. 1 cas
 *    7. `callIcon` figé sur l'état repos ................................. 1 cas
 *    8. `title` figé ..................................................... 1 cas
 *    9. `!Array.isArray(users)` retiré .................................... 1 cas
 *   10. `users.length === 0` retiré ...................................... 0 cas — ASSUMÉ
 *   11. `user.userSlug !== props.user.slug` retiré ....................... 2 cas
 *   12. la comparaison de type de `onCloseCall` retirée (`return true`) .. 2 cas
 *   13. `!user` retiré de la même ligne .................................. 1 cas
 *   14. la première ligne du prédicat de `some` neutralisée (GROUPÉ) ..... 2 cas
 *   15. `eventBus.$off` retiré ........................................... 1 cas
 *   16. `eventBus.$on` retiré ............................................ 3 cas
 *   17. la garde de slug retirée de `onCallUser` ......................... 1 cas
 *   18. `normalizeDirectCallType` du `typeAppel` en passe-plat ........... 1 cas
 *   19. `default: 'visio'` de la prop `type` retiré ...................... 0 cas — ABSORBÉ
 *   20. la garde `!busPret` retirée de `onCallUser` ...................... 0 cas — ABSORBÉ
 *   21. l'ORDRE d'avant le lot (`AWN.info` avant l'état, hors `try`) ..... 2 cas
 *   22. le prédicat des 3 méthodes réduit à `!!eventBus` ................. 1 cas
 *   23. `normalizeDirectCallType` de `onCloseCall` seul, en passe-plat ... 1 cas
 *
 * **Trois zéros, et AUCUN n'est une faute du test — chacun porte sa raison mesurée.**
 *
 * ⭐ **n° 10 : 0 ASSUMÉ.** `[].some()` est faux de toute façon, donc la moitié `length === 0`
 * du garde est strictement redondante. Aucun cas ne peut la distinguer. Écrit ici pour ne pas
 * la re-mesurer dans six mois.
 *
 * ⭐ **n° 19 et n° 20 : 0 par ABSORPTION, et la règle du lot E a servi** — « un contrôle à 0
 * doit faire chercher quelle AUTRE ligne absorbe la mutation ». Les deux ont été re-mesurés en
 * neutralisant **les deux mécanismes ensemble**, et les deux rougissent alors :
 *   - n° 19 : le défaut de prop est absorbé par `normalizeDirectCallType`, qui rend `'visio'`
 *     sur `undefined`. Défaut + normalisation neutralisés ensemble ⇒ **5 cas**.
 *   - n° 20 : la garde du handler est absorbée par `:disabled`, VTU refusant de dispatcher sur
 *     un bouton désactivé (cf. le fait de harnais ci-dessus — et un vrai navigateur fait
 *     pareil). Garde du handler + garde du rendu neutralisées ensemble ⇒ **2 cas**.
 * Les deux lignes sont donc CONSERVÉES : ce sont deux mécanismes indépendants qui tiennent la
 * même propriété, exactement le cas que la règle « neutraliser les DEUX mécanismes » vise.
 *
 * ⚠️ Le n° 14 est un contrôle groupé, mais il ne couvre que les n° 11 et 13 — la comparaison de
 * type (n° 12) survit à la mutation. Sa somme n'est donc pas 11+12+13 : c'est l'union de 11 et
 * 13, soit 2. L'annonce « 14 = 11+12+13 » était fausse, corrigée après mesure.
 *
 * ⚠️ Les n° 6, 7 et 8 rougissent 1 cas chacun là où 2 étaient annoncés — l'icône et le titre
 * sont assertés dans le même cas. Mesurés séparément quand même : ce sont deux rendus
 * distincts, et les fusionner masquerait la disparition de l'un des deux.
 *
 * ⚠️ Le n° 21 se mesure sur la version d'AVANT le correctif, comme le n° 7 de
 * `LocalStreamBtn.test.js` : c'est le rouge qui autorisait à réordonner. Une négative jamais
 * vue rouge ne garde rien.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import CallRemotePeerBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/CallRemotePeerBtn.vue'
import { mockEventBus } from './helpers/mockEventBus.js'

/**
 * Un bus FRAIS par montage : `$emit` y rejoue réellement les handlers de `$on`, ce qui est
 * indispensable pour exercer `onCloseCall`. Un triple `vi.fn()` muet ne conviendrait qu'aux
 * cas qui assertent l'émission.
 *
 * `awn: null` monte SANS fournisseur de notifieur — et comme `window.AWN` n'est jamais posé
 * ici, c'est un montage réellement dépourvu des deux voies.
 */
const monter = ({ user = { slug: 'bob' }, type, awn = { info: vi.fn(), alert: vi.fn() } } = {}) => {
    const bus = mockEventBus()
    const provide = awn === null ? { eventBus: bus } : { AWN: awn, eventBus: bus }
    const wrapper = mount(CallRemotePeerBtn, {
        // `type` n'est passé QUE s'il est fourni : `Cover.vue` ne le passe jamais, donc le
        // défaut est le chemin de production et doit rester exerçable.
        props: type === undefined ? { user } : { user, type },
        global: { provide },
    })
    return { wrapper, bus, awn }
}

/** Monte sans aucun eventBus — le cas de la dépendance manquante. */
const monterSansBus = (user = { slug: 'bob' }) =>
    mount(CallRemotePeerBtn, {
        props: { user },
        global: { provide: { AWN: { info: vi.fn(), alert: vi.fn() } } },
    })

const bouton = (wrapper) => wrapper.get('button')

/** L'armement se lit sur l'ATTRIBUT : c'est celui sur lequel VTU et le navigateur ferment. */
const estArme = (wrapper) => bouton(wrapper).attributes('disabled') !== undefined

const invitations = (bus) => bus.$emit.mock.calls.filter(([nom]) => nom === 'call-user')

let avertissements

beforeEach(() => {
    avertissements = []
    vi.spyOn(console, 'error').mockImplementation((m) => avertissements.push(String(m)))
})

describe('CallRemotePeerBtn — le bouton d\'appel du mur', () => {

    describe('au repos', () => {
        it('⭐ il propose un appel visio, et c\'est le seul chemin de production', () => {
            // Prop `type` OMISE : `Cover.vue:33-36` ne la passe jamais, donc le défaut `'visio'`
            // EST la production. Un cas qui la passerait toujours ne testerait qu'un chemin
            // que personne n'emprunte.
            const { wrapper } = monter()

            expect(bouton(wrapper).find('.la-video').exists()).toBe(true)
            expect(bouton(wrapper).find('.la-phone').exists()).toBe(false)
            expect(bouton(wrapper).attributes('title')).toBe('Appel visio')
            expect(estArme(wrapper)).toBe(false)
        })

        it('en vocal, l\'icône ET le titre changent', () => {
            // Les deux, et pas seulement l'icône : retirer le défaut de la prop ne changerait
            // PAS l'icône (`undefined` tombe dans la branche visio du computed), seul le titre
            // le trahirait. C'est ce qui rend le contrôle n° 19 mesurable à 2 et non à 1.
            const { wrapper } = monter({ type: 'vocal' })

            expect(bouton(wrapper).find('.la-phone').exists()).toBe(true)
            expect(bouton(wrapper).find('.la-video').exists()).toBe(false)
            expect(bouton(wrapper).attributes('title')).toBe('Appel vocal')
        })

        it('⭐ un type inconnu est NORMALISÉ, il ne fuit pas vers l\'aval', async () => {
            // `isValidCallType` accepte `data`, `stream`, `screen`, `visio`, `vocal` — il vaut
            // pour le type d'un CONTEXTE, pas d'un appel direct. Le repli de
            // `useCallManager.js` ne rattrapait donc pas un `type="screen"`, qui passait en
            // CALLING puis mourait sans retry. `normalizeDirectCallType` ne connaît que les
            // deux types d'un appel direct, et normalise à la SOURCE : le titre, l'icône et
            // l'invitation disent tous les trois `visio`.
            const { wrapper, bus } = monter({ type: 'screen' })

            expect(bouton(wrapper).attributes('title')).toBe('Appel visio')
            expect(bouton(wrapper).find('.la-video').exists()).toBe(true)

            await bouton(wrapper).trigger('click')

            expect(bus.$emit).toHaveBeenCalledWith('call-user', 'bob', 'visio')
        })
    })

    describe('lancer l\'appel', () => {
        it('⭐ le clic envoie l\'invitation sur le bus — le slug d\'abord, le type ensuite', async () => {
            const { wrapper, bus } = monter()

            await bouton(wrapper).trigger('click')

            // L'ordre des arguments EST le joint avec `Notifications.vue:231` →
            // `onStartCall(toUserSlug, type)`, qui est positionnel. Les permuter partirait
            // sans erreur et l'appel finirait sur le `!isValidSlug` silencieux de
            // `useCallManager.js:107`.
            expect(bus.$emit).toHaveBeenCalledWith('call-user', 'bob', 'visio')
            expect(invitations(bus)[0]).toHaveLength(3)
        })

        it('⭐ le clic prévient l\'utilisateur et arme le bouton', async () => {
            const { wrapper, awn } = monter()

            await bouton(wrapper).trigger('click')
            await nextTick()

            expect(awn.info).toHaveBeenCalledWith('Appel bob')
            expect(estArme(wrapper)).toBe(true)
            expect(bouton(wrapper).find('.la-video-slash').exists()).toBe(true)
        })

        it('⭐ armé, il ne renvoie plus rien — et sans `close-call` il le reste indéfiniment', async () => {
            // ── CE QUE CE CAS CONSTATE, ET N'APPROUVE PAS ──────────────────────────────
            // L'armement optimiste n'est pas réconcilié. `startCallWithPeer` a trois sorties
            // silencieuses (`!payload`, `!isValidSlug`, transition CALLING refusée) et son
            // aval, `requestAuthorizationRemotePeerId`, rend `null` sans peerId local
            // publiable. Sur ces chemins, aucun `close-call` n'était jamais émis — les seuls
            // émetteurs sont `useCallManager.js:490` et `Notifications.vue` (refus, abandon,
            // raccrocher) — donc le bouton restait mort jusqu'au rechargement de la page.
            //
            // Le pire n'était même pas le bouton : la FSM restait en CALLING pour la vie de
            // l'onglet, ce qui interdisait TOUT appel suivant. Fermé côté moteur par le même
            // lot (`useCallManager.test.js`, § « l'invitation n'est pas émise ») ; ce cas-ci
            // ne garde que la moitié bouton : deux clics ne font qu'UNE invitation.
            const { wrapper, bus } = monter()

            await bouton(wrapper).trigger('click')
            await nextTick()
            await bouton(wrapper).trigger('click')

            expect(invitations(bus)).toHaveLength(1)

            await nextTick()
            await nextTick()
            expect(estArme(wrapper)).toBe(true)
        })

        it('⭐ un `user` sans slug n\'envoie rien et n\'arme pas le bouton', async () => {
            // Sans cette garde, le bouton émettait `('call-user', undefined, 'visio')` — rejeté
            // en silence par `isValidSlug` en aval — ET se désactivait quand même. Un bouton
            // définitivement mort pour un appel qui n'a jamais existé.
            const { wrapper, bus, awn } = monter({ user: {} })

            await bouton(wrapper).trigger('click')
            await nextTick()

            expect(invitations(bus)).toHaveLength(0)
            expect(estArme(wrapper)).toBe(false)
            expect(awn.info).not.toHaveBeenCalled()
        })
    })

    describe('la fin de l\'appel le rend à l\'utilisateur', () => {
        it('⭐ un `close-call` qui le nomme le réarme, icône comprise', async () => {
            const { wrapper, bus } = monter()

            await bouton(wrapper).trigger('click')
            await nextTick()
            expect(estArme(wrapper)).toBe(true)

            // Le payload est le littéral de production, celui que `useCallManager.js:490`
            // émet et que `useCallManager.test.js` épingle de l'autre côté.
            bus.$emit('close-call', [{ userSlug: 'bob', type: 'visio' }])
            await nextTick()

            expect(estArme(wrapper)).toBe(false)
            expect(bouton(wrapper).find('.la-video').exists()).toBe(true)
        })

        it('un `close-call` qui nomme un AUTRE pair, ou un AUTRE type, ne le réarme pas', async () => {
            // Deux moitiés, et la seconde est atteignable : `close-call` circule avec
            // `type: 'stream'` quand un pair quitte une room de DIFFUSION
            // (`useCallManager.test.js`, § remoteStopCall). Un pair qui s'en va d'une
            // diffusion n'a pas à réarmer mon bouton d'appel visio.
            //
            // ⚠️ Un périmètre à un seul élément ne distingue pas « la bonne cible » de
            // « n'importe qui » — la leçon des quatre contre-épreuves à zéro de la tâche 6.
            const autrePair = monter()
            await bouton(autrePair.wrapper).trigger('click')
            await nextTick()
            autrePair.bus.$emit('close-call', [{ userSlug: 'alice', type: 'visio' }])
            await nextTick()
            expect(estArme(autrePair.wrapper)).toBe(true)

            const autreType = monter({ type: 'vocal' })
            await bouton(autreType.wrapper).trigger('click')
            await nextTick()
            autreType.bus.$emit('close-call', [{ userSlug: 'bob', type: 'visio' }])
            await nextTick()
            expect(estArme(autreType.wrapper)).toBe(true)
        })

        it('⭐ une entrée sans type réarme le bouton visio, et lui seul', async () => {
            // La branche `if (!eventType) return true` remettait à zéro QUEL QUE SOIT le type
            // du bouton — une tolérance qu'aucun émetteur n'exerce (les quatre portent un
            // `type`). Remplacée par la normalisation : une entrée sans type vaut `visio`,
            // comme partout ailleurs dans la chaîne. Comportement inchangé pour les quatre
            // émetteurs réels, ambiguïté supprimée.
            const visio = monter()
            await bouton(visio.wrapper).trigger('click')
            await nextTick()
            visio.bus.$emit('close-call', [{ userSlug: 'bob' }])
            await nextTick()
            expect(estArme(visio.wrapper)).toBe(false)

            const vocal = monter({ type: 'vocal' })
            await bouton(vocal.wrapper).trigger('click')
            await nextTick()
            vocal.bus.$emit('close-call', [{ userSlug: 'bob' }])
            await nextTick()
            expect(estArme(vocal.wrapper)).toBe(true)
        })

        it('un payload que le réseau a pu inventer ne le fait pas tomber', async () => {
            // Le producteur n'est pas hypothétique : `Notifications.vue:147-149` réémet
            // `eventBus.$emit(event.type, event.payload)` depuis `.EventBusNotification`,
            // donc le SERVEUR peut poster un `close-call` avec n'importe quelle charge.
            const { wrapper, bus } = monter()

            await bouton(wrapper).trigger('click')
            await nextTick()

            for (const charge of [undefined, null, 'bob', 42, [], [null], [{}]]) {
                expect(() => bus.$emit('close-call', charge)).not.toThrow()
            }
            await nextTick()

            expect(estArme(wrapper)).toBe(true)
        })
    })

    describe('l\'abonnement et sa fin', () => {
        it('⭐ démonté, il n\'écoute plus — et c\'est le registre qui le dit', async () => {
            const { wrapper, bus } = monter()

            expect(bus._listeners['close-call']).toHaveLength(1)

            wrapper.unmount()

            // L'observable ici est le REGISTRE, pas un effet : écrire dans le `ref` d'un
            // composant démonté ne lève rien et ne montre rien. C'est exactement pour ça que
            // `helpers/mockEventBus.js:32-34` expose `_listeners`.
            expect(bus._listeners['close-call']).toHaveLength(0)
            // Et la même RÉFÉRENCE de handler : un `$off` sur une fonction recréée ne retire
            // rien, et laisserait le registre plein sans erreur.
            expect(bus.$off.mock.calls[0][1]).toBe(bus.$on.mock.calls[0][1])
        })
    })

    describe('où il trouve de quoi notifier, et de quoi appeler', () => {
        it('⭐ sans aucun notifieur, l\'invitation part quand même et le bouton s\'arme', async () => {
            // Le cas qui garde le correctif. Avant, `AWN.info` était appelé ENTRE l'émission
            // et l'écriture d'état : sans notifieur il levait, l'invitation était déjà partie
            // et le bouton restait actif — donc renvoyable en boucle. La `TypeError` était
            // avalée par `callWithErrorHandling` de Vue : ni toast, ni trace utile.
            const { wrapper, bus } = monter({ awn: null })

            await bouton(wrapper).trigger('click')
            await nextTick()

            expect(invitations(bus)).toHaveLength(1)
            expect(estArme(wrapper)).toBe(true)
        })

        it('⭐ un notifieur qui LÈVE ne défait pas un appel déjà parti', async () => {
            // C'est la forme mesurable du réordonnancement : `AWN.info` était appelé ENTRE
            // l'émission et l'écriture d'état. Un toaster qui lève laissait donc l'invitation
            // partie et le bouton actif — renvoyable en boucle. L'état passe maintenant avant,
            // et le toast est enveloppé : l'ordre ET le `try` se mesurent sur ce seul cas.
            const awn = { info: vi.fn(() => { throw new Error('toaster cassé') }), alert: vi.fn() }
            const { wrapper, bus } = monter({ awn })

            await bouton(wrapper).trigger('click')
            await nextTick()

            expect(invitations(bus)).toHaveLength(1)
            expect(estArme(wrapper)).toBe(true)
        })

        it('⭐ sans eventBus, le bouton se DÉSACTIVE et le dit — il ne fait pas semblant', async () => {
            // La dissymétrie assumée avec `AWN` : le bus est la fonctionnalité, pas un
            // ornement. Dégrader en no-op donnerait un bouton qui accepte le clic, se
            // désactive et n'envoie rien — « un bouton qui ne fait rien est pire que pas de
            // bouton » (`Cover.vue:29-32`). Il l'avoue donc, et une seule fois : au setup,
            // pas à chaque clic.
            const wrapper = monterSansBus()

            expect(estArme(wrapper)).toBe(true)
            expect(avertissements.join('\n')).toMatch(/CallRemotePeerBtn.*eventBus/s)
            expect(avertissements).toHaveLength(1)
        })

        it('un bus incomplet vaut un bus absent', () => {
            // Même prédicat que `createPeerContext.js:96` : les TROIS méthodes. Un objet qui
            // n'a que `$emit` passerait une garde de présence et casserait au `$on` du
            // montage — plus loin de sa cause.
            const wrapper = mount(CallRemotePeerBtn, {
                props: { user: { slug: 'bob' } },
                global: { provide: { AWN: { info: vi.fn() }, eventBus: { $emit: vi.fn() } } },
            })

            expect(estArme(wrapper)).toBe(true)
            expect(avertissements.join('\n')).toMatch(/eventBus/)
        })
    })
})
