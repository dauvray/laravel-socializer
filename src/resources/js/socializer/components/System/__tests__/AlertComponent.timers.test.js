/**
 * AlertComponent.timers.test.js — les minuteurs des deux alertes, sous horloge factice
 *
 * Les deux alertes d'appel entrant arment deux minuteurs à leur montage : la sonnerie, qui répète
 * toutes les secondes, et l'auto-refus, qui répond « non » à la place de l'utilisateur au bout de
 * 20 s (vocal) ou 10 s (visio). Ce fichier épingle ce que ces deux minuteurs doivent faire, et
 * surtout ce qu'ils ne doivent plus faire une fois qu'on a répondu ou quitté l'écran.
 *
 * ⚠️ **TROISIÈME harnais sur ces composants, et c'est une frontière d'HORLOGE.** Les deux fichiers
 * de A1 — `AlertComponent.test.js` (l'unité) et `Notifications.alerts.test.js` (la couture) —
 * tournent sous timers RÉELS et le déclarent. Rien de ce qui est asserté ici ne peut rougir
 * là-bas : ce n'est pas une question d'altitude, les deux y sont bonnes, c'est que le fait n'existe
 * pas sous une horloge qu'on ne pilote pas. C'est un cinquième type de frontière après celles de
 * couche et de couture déjà mesurées par le paquet (`docs/architecture/tests.md`).
 *
 * ⚠️ **PREMIER montage de composant Vue sous `vi.useFakeTimers()` du paquet.** Les vingt fichiers
 * de `WebRTC2/__tests__/` qui pilotent une horloge montent des *composables*, jamais un composant.
 * Ce qui rend la chose possible tient à un fait de configuration : `toFake` de Vitest 2.1.9
 * (`vitest/dist/config.js:80-92`) ne contient QUE
 * `setTimeout|clearTimeout|setInterval|clearInterval|setImmediate|clearImmediate|Date` —
 * **aucune microtâche**. L'ordonnanceur de Vue est promesse-based : `nextTick()` et le rendu
 * résolvent sans qu'on avance quoi que ce soit. Sans ce fait, rien de ce fichier ne tiendrait.
 *
 * ⚠️ **`vi.dynamicImportSettled()` survit à l'horloge factice, et c'est vérifié dans la source.**
 * Son `waitNextTick()` fait `setTimeout(resolve, 0)` sur les minuteurs rendus par `getSafeTimers()`
 * (`vitest/dist/chunks/utils.C8RiOc4B.js:53-56` et `@vitest/utils/dist/index.js:602-618`, qui lit
 * `globalThis[SAFE_TIMERS_SYMBOL]`) : ce sont les minuteurs ORIGINAUX, que `useFakeTimers` ne
 * remplace pas. Corollaire à ne pas chercher : **avancer l'horloge n'aide JAMAIS à résoudre un
 * `import()`**. Un lecteur qui verrait un nœud commentaire et tenterait `advanceTimersByTimeAsync`
 * pour « laisser le temps » n'obtiendrait rien — la seule attente qui marche est la même que sous
 * horloge réelle. Et `vi.waitFor` reste INTERDIT sous faux timers (mesuré ailleurs, ne pas
 * re-mesurer : `WebRTC2/__tests__/helpers/bootLocalPeer.js:42-82`).
 *
 * ⚠️ **Faux timers AVANT le montage, et c'est une décision.** Le minuteur qu'on pilote est armé
 * PENDANT `mounted()` : installés après, les deux minuteurs seraient réels et la moitié du fichier
 * serait verte par vacuité. C'est le même sens que `usePeerTransport.iceRefresh.test.js`, et
 * l'inverse de `usePeerTransport.singleton.test.js` — l'ordre est une décision par fichier, pas une
 * convention. Ici l'argument est plus court que chez le voisin : rien d'autre que le
 * `defineAsyncComponent` n'est asynchrone au montage, et il ne dépend d'aucune horloge (les deux
 * points ci-dessus).
 *
 * ⚠️ **`vi.getTimerCount()` compte DEUX minuteurs qui n'appartiennent pas à l'alerte.** Mesuré à la
 * sonde (`setTimeout` instrumenté, piles d'appel relevées), et contre-intuitif dans les deux cas :
 *   • **`defineAsyncComponent` arme un `setTimeout` de 200 ms MÊME SANS OPTION** — `delay = 200` est
 *     son défaut (`runtime-core.cjs.js:2523`), et Vue ne l'annule PAS à la résolution : il reste en
 *     attente. Ne pas croire la lecture rapide « il n'arme un minuteur que si on lui passe `delay`
 *     ou `timeout` » ; c'est faux, et c'est ce qui a fait naître ce fichier avec un contrôle à 4
 *     là où 2 était prédit ;
 *   • **le renderer de Vue arme un `setTimeout` de 3 s à sa création** — `setDevtoolsHook$1`
 *     (`runtime-core.cjs.js:602`), atteint par `ensureRenderer`. **Une seule fois par fichier**,
 *     donc il est imputé au premier montage et absent des suivants : un comptage absolu dépendrait
 *     de l'ordre des cas.
 * D'où la forme des deux assertions de comptage : **jamais un absolu, toujours un delta autour du
 * seul geste mesuré**, et une avance de 200 ms pour purger le minuteur de `delay` avant de compter.
 *
 * ⚠️ **`unmount()` PUIS `useRealTimers()`, dans UN SEUL `afterEach`.** Un `describe` imbriqué
 * verrait son `afterEach` tourner AVANT celui du fichier (`@vitest/runner/dist/index.js:968-973`,
 * `sequence.hooks: 'stack'`) : on démonterait sous l'horloge réelle un composant monté sous
 * l'horloge factice, et le harnais ne serait correct que par coïncidence de deux teardowns sans
 * rapport. C'est la première des trois raisons pour lesquelles ce fichier est séparé plutôt
 * qu'imbriqué dans `AlertComponent.test.js`.
 *
 * ⚠️ **Aucun import des deux alertes par leur chemin — et c'est ICI que la tentation est maximale.**
 * Tester un minuteur donne envie de monter le composant qui le porte. Interdit, pour la raison de
 * A1 : les alertes sont atteintes par leur `name` et par leur titre rendu, deux identités que le
 * `git mv` du lot C ne touche pas. Le prix est de passer par `AlertComponent` et par `options.type`
 * pour choisir l'alerte ; le gain est qu'aucune ligne de ce fichier ne sera à modifier au lot C.
 *
 * ⚠️ **Pas de stub `Audio`, comme A1 — et ici c'est OBLIGATOIRE, pas seulement suffisant.**
 * L'observable du dernier cas est un espion posé sur l'instance réelle d'`Audio` du composant. Un
 * stub global la remplacerait par un double, et l'assertion deviendrait « mon double a été appelé ».
 * Deux mesures qui vont avec : happy-dom sort tôt de `pause()` si l'élément est déjà en pause
 * (`HTMLMediaElement.js:691-697`), donc **`ding.paused` n'est PAS discriminant** ; et `play()` est
 * `async` sans aucun minuteur (`:701-708`, zéro `setTimeout` dans tout le fichier), donc avancer
 * 20 s ne coûte que 20 promesses qui se règlent au fil de l'eau, sans rejet non traité.
 * ⚠️ `vitest.config.js` n'a **ni `clearMocks` ni `restoreMocks`** : les espions ne sont pas
 * restaurés tout seuls. Ceux d'ici portent sur des `Audio` créés par le cas et morts avec lui, donc
 * la fuite est bornée — mais ça s'écrit plutôt que ça ne se suppose.
 *
 * ── LES DEUX CAS QUI ASSERTENT UN MÉCANISME, ET POURQUOI ILS N'ONT PAS LE CHOIX ──
 * « Démonter n'y laisse aucun minuteur » et « plus rien ne s'exécute après » sont les seuls cas du
 * fichier à ne pas asserter un fait métier. Le fait métier correspondant — « une alerte morte ne
 * répond plus » — est **inobservable par construction**, et par DEUX barrières indépendantes :
 *   • Vue 3.5.24 avale l'émission d'une instance démontée — `emit()` commence par
 *     `if (instance.isUnmounted) return` (`@vue/runtime-core/dist/runtime-core.cjs.js:6367`), et
 *     l'enregistrement pour les tests (`devtoolsComponentEmit`, `:6406`) est DERRIÈRE la garde ;
 *   • et `VueWrapper.unmount()` SUPPRIME l'historique des émissions —
 *     `removeEventHistory(this.vm)` (`@vue/test-utils/dist/vue-test-utils.cjs.js:7687`).
 * Retirer l'une n'y changerait rien. Ce que ces deux cas gardent est donc le CONTRAT de l'alerte —
 * elle doit pouvoir être démontée par n'importe quel parent sans laisser de traînée — et pas son
 * symptôme. Le parent d'aujourd'hui masque la traînée ; le lot C est sur le point de déplacer ces
 * deux composants, et rien ne garantit que leurs prochains parents la masqueront.
 *
 * ⚠️ **C'est aussi ce qui interdit d'écrire un seul de ces cas dans `Notifications.alerts.test.js`.**
 * `onResponseAlert` y met `notificationComponent.value = null` en PREMIÈRE ligne
 * (`Notifications.vue:205`), donc répondre démonte l'alerte avant l'échéance : le rouge annoncé par
 * `work/doc-rustines.md` (« accepter à 5 s n'émet pas de refus à 10 s ») y serait né **VERT**, ce
 * que la règle n° 2 du paquet interdit. Il est ici, à l'étage `AlertComponent`, qui ne démonte
 * jamais l'alerte : il ne fait que ré-émettre.
 *
 * ── CE QUE CE FICHIER A ÉPINGLÉ : B2 ────────────────────────────────────────────
 * Écrit rouge de cinq cas. Dans les deux alertes, le handle du `setTimeout` d'auto-refus n'était pas
 * stocké — `beforeUnmount → stopDing()` n'annulait que l'`interval` de la sonnerie — et le garde du
 * callback, `if(!this.pickedUp)`, ne servait à rien : `pickedUp` n'était JAMAIS écrit à `true`, son
 * unique lecteur du paquet étant ce `if`. Deux moitiés : une réponse donnée pouvait être contredite
 * par un refus tardif, et le minuteur survivait au démontage. Le correctif annule le minuteur sur le
 * chemin commun aux trois sorties — accepter, refuser, quitter l'écran — ce qui ferme les deux, et
 * rend `pickedUp` mort au sens strict (supprimé, sortie B).
 *
 * ⚠️ **Et c'est B1 qui avait armé la moitié (a) sur la branche vocale** : avant lui,
 * `AudioCallAlert` émettait `response-call`, que personne n'écoutait — son auto-refus partait dans
 * le vide. Le récit est dans `git log`.
 *
 * ── HORS PÉRIMÈTRE, NOMMÉMENT ───────────────────────────────────────────────────
 * • **La face VIVE de la même famille : une seconde invitation PATCHE l'alerte au lieu de la
 *   remonter** (lot **B5** de `work/doc-rustines.md`). `Notifications.vue:93` réaffecte le MÊME
 *   objet composant, donc ni `AlertComponent.created()` ni le `mounted()` de l'alerte ne rejouent :
 *   aucun nouveau minuteur n'est armé et l'ancien tire sur les `options` du second appelant. **B2 ne
 *   le referme pas** — il n'y a pas de démontage — et un cas écrit ici resterait rouge après B2,
 *   c'est-à-dire un rouge qu'aucun lot ne ferme. Son rouge ne demande d'ailleurs AUCUN faux timer :
 *   il est de couture, et il ira dans `Notifications.alerts.test.js`.
 * • **Ce que les deux alertes AFFICHENT et remontent** : c'est A1, `AlertComponent.test.js`. Rien
 *   ici n'asserte sur le mapping `vocal`/`visio` autrement que comme garde-fou, ni sur la forme de
 *   `response-alert(slug, options, status)`.
 * • **La sonnerie comme fichier audio** : `new Audio(url)` ne fait que poser l'attribut `src` sous
 *   happy-dom, aucune requête ne part. Ce qui est asserté est la CADENCE, pas le son.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ──────────
 * Rouges TOTAUX par fichier sous mutation. **La référence a été relue à 0 avant chaque mesure** et
 * les cinq fichiers en sont sortis verts — ces chiffres sont donc directement des écarts, ce qui
 * n'était pas le cas pour A1 (mesuré avant B1, référence non verte). Colonnes :
 * ce fichier · unitaire · couture · câblage · callControls.
 *
 * LE CORRECTIF — mutations dans les DEUX alertes, sauf mention :
 *    1. `clearTimeout` retiré de `stopAlert()`, côté VOCAL seulement ... 4 · 0 · 0 · 0 · 0
 *    2. `clearTimeout` retiré des DEUX ........................... **5** · 0 · 0 · 0 · 0
 *    3. `clearInterval` retiré de `stopAlert()` ...................... 2 · 0 · 0 · 0 · 0
 *    4. `beforeUnmount` vidé entièrement ............................. 2 · 0 · 0 · 0 · 0
 *    5. l'échéance vocale ramenée à 10 000 (les deux unifiées) ....... 1 · 0 · 0 · 0 · 0
 *    6. le `setTimeout` d'auto-refus SUPPRIMÉ (le faux correctif) .... 2 · 0 · 0 · 0 · 0
 *    7. le `setInterval` de sonnerie supprimé ........................ 3 · 0 · 0 · 0 · 0
 *
 * LE HARNAIS — mutations dans ce fichier :
 *    8. `vi.useFakeTimers()` déplacé APRÈS le montage ................ 4
 *    9. `await vi.dynamicImportSettled()` supprimé ................... 9
 *   10. `flushPromises()` ×4 au lieu de `dynamicImportSettled` ....... 9
 *   11. `advanceTimersByTimeAsync` → `advanceTimersByTime` synchrone . 0   ← 0 conservé
 *   12. le garde-fou (premier cas) retiré ........................... 0   ← 0 attendu
 *
 * ⭐ **LE CHIFFRE QUI VAUT CE FICHIER : le n° 2 rougit 5 cas ici et ZÉRO des quatre autres.** Les
 * deux alertes peuvent redevenir incapables d'annuler leur auto-refus — un appel accepté peut être
 * refusé vingt secondes plus tard, un minuteur peut survivre à l'écran qui l'a armé — sans qu'un
 * seul cas des deux fichiers de A1 ni des deux autres fichiers de `Notifications` bouge. Ils sont
 * pourtant à la bonne altitude et montent les mêmes composants : ce qui les sépare est l'HORLOGE.
 *
 * **Trois lectures qui ne sautent pas aux yeux** :
 *
 * • **n° 1 rougit 4 et n° 2 rougit 5 : l'écart d'UN seul cas est le prix du jumeau visio.** Corriger
 *   une alerte et pas l'autre — le mode de panne le plus probable de ce lot, et exactement ce qui
 *   était arrivé à B1 — ne coûte qu'un rouge. C'est peu, et c'est pour ça que le cas visio existe
 *   en propre au lieu d'être une boucle sur le cas vocal : sans lui, l'écart serait de zéro.
 * • **n° 6 rougit 2, pas 1 — et c'est mieux que prévu.** Le faux correctif « supprimer le
 *   `setTimeout` » (qui rendrait les cinq rouges verts d'un coup en supprimant la fonctionnalité)
 *   est attrapé par le cas des échéances ET par celui du comptage de minuteurs, qui voit le
 *   démontage n'en libérer qu'un au lieu de deux. Deux cas indépendants le ferment.
 * • **n° 8 rougit 4 sur 9, donc CINQ cas passeraient au vert par vacuité** si les faux timers
 *   étaient installés après le montage : les minuteurs seraient réels, aucune échéance ne tomberait
 *   dans la vie du cas, et toutes les assertions « rien de plus n'a été émis » seraient vraies pour
 *   rien. C'est la mesure de la décision d'ordre, et la raison de l'écrire en tête.
 *
 * **Les deux 0, avec leur raison** — aucun n'est « la ligne est inutile » :
 *
 * • **n° 11** : la chaîne d'émission `$emit` de l'alerte → `onResponseAlert` → `$emit` du parent est
 *   entièrement SYNCHRONE, donc l'avance synchrone suffit à tout ce qui est asserté ici. La forme
 *   `await` reste néanmoins la règle — c'est celle du paquet (~120 occurrences) et elle tient à deux
 *   faits qui ne sont pas assertés : les promesses de `ding.play()` doivent se régler, et le premier
 *   cas qui assertera sur le DOM après une échéance aura besoin du rendu. 0 noté pour ne pas être
 *   re-mesuré.
 * • **n° 12** : un garde-fou de vacuité ne rougit rien par construction — il n'est pas là pour
 *   attraper une mutation, il est là pour empêcher les autres cas de verdir à tort. Sa contre-épreuve
 *   est le n° 9, où il rougit le premier et nomme la cause.
 *
 * ⚠️ **n° 9 et n° 10 rougissent TOUS LES DEUX les 9 cas, et il faut lire le second correctement.**
 * `flushPromises()` **survit** aux faux timers : VTU fige son ordonnanceur à l'ÉVALUATION DU MODULE
 * — `const scheduler = typeof setImmediate === 'function' ? setImmediate : setTimeout`
 * (`@vue/test-utils/dist/vue-test-utils.cjs.js:8374`) —, donc il tient la référence RÉELLE, prise
 * avant tout `useFakeTimers`. Il ne bloque pas, il ne lève pas — il rend la main sans résoudre
 * l'`import()`,
 * exactement comme sous horloge réelle. Ne pas transporter ici le verdict d'A1, où `flushPromises`
 * passait : là-bas la chaîne de modules est courte (l'alerte n'importe qu'`IconWidget`) et une
 * macrotâche suffisait. Ici elle ne suffit pas — c'est la profondeur de la chaîne qui décide, et
 * l'outil déterministe reste la règle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AlertComponent from '~socializer/components/System/widgets/AlertComponent.vue'

// ─── Harnais ─────────────────────────────────────────────────────────────────
// ⚠️ Les cinq helpers ci-dessous sont RECOPIÉS d'`AlertComponent.test.js:142-171`, pas extraits
// vers `helpers/`. Extraire imposerait d'éditer les deux fichiers de A1, qui sont les pièces à
// conviction de B1 (21/21 verts, aucune assertion touchée). Le bon moment pour l'extraction est le
// lot C, qui déplace les deux alertes et re-mesure ces fichiers de toute façon.

/**
 * Un bloc `options` tel que `.AlertToUser` le diffuse : les cinq clés de la liste blanche de
 * `UserController::sendAlertToUser`, et rien d'autre.
 */
const invitation = (type) => ({
    type,
    action: 'peer-access-permission',
    room: 'call-room-1',
    peerId: '00000000-0000-4000-8000-000000000001',
    inviteId: 'invite-1',
})

/**
 * Monte l'alerte et attend la résolution du composant asynchrone.
 * ⚠️ `dynamicImportSettled` et pas une avance d'horloge : voir l'en-tête.
 */
const monter = async (type, fromUserSlug = 'bob') => {
    const w = mount(AlertComponent, {
        props: { fromUserSlug, options: invitation(type) },
    })
    await vi.dynamicImportSettled()
    return w
}

/** L'alerte réellement montée, identifiée par son `name` — que le lot C ne déplacera pas. */
const alerte = (w, nom) => w.findComponent({ name: nom })

const accepter = (w) => w.find('.btn-success')
const refuser = (w) => w.find('.btn-danger')

/** La sonnerie de l'alerte montée : l'objet `Audio` réel du composant, pas un double. */
const sonnerie = (w, nom) => alerte(w, nom).vm.ding

let wrapper

beforeEach(() => {
    // AVANT le montage : `mounted()` arme les deux minuteurs qu'on pilote.
    vi.useFakeTimers()
})

afterEach(() => {
    // ① sous la MÊME horloge qu'au montage, puis ② la file factice est jetée en bloc — donc rien
    // ne peut fuir d'un cas au suivant, même quand le composant laisse un minuteur derrière lui.
    wrapper?.unmount()
    wrapper = undefined
    vi.useRealTimers()
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Les minuteurs des deux alertes d\'appel entrant', () => {

    it('⭐ sous horloge factice, l\'alerte est réellement montée, avec ses deux boutons — le garde-fou de tout ce fichier', async () => {
        wrapper = await monter('vocal')

        // Sans ce cas, un `dynamicImportSettled` oublié rendrait les huit autres verts par vacuité :
        // un composant asynchrone non résolu est un nœud commentaire, et toute recherche dans le DOM
        // y répond « absent » sans erreur. Et il vaut ici pour une raison de plus qu'en A1 : sous
        // horloge factice, aucune avance ne ferait jamais aboutir l'import — voir l'en-tête.
        expect(vi.isFakeTimers()).toBe(true)
        expect(alerte(wrapper, 'AudioCallAlert').exists()).toBe(true)
        expect(wrapper.findAll('button')).toHaveLength(2)
    })

    describe('la sonnerie', () => {

        it('retentit une fois par seconde tant que personne ne répond', async () => {
            wrapper = await monter('vocal')
            const play = vi.spyOn(sonnerie(wrapper, 'AudioCallAlert'), 'play')

            await vi.advanceTimersByTimeAsync(3000)

            expect(play).toHaveBeenCalledTimes(3)
        })

        it('⭐ répondre la coupe sur-le-champ', async () => {
            wrapper = await monter('vocal')
            const play = vi.spyOn(sonnerie(wrapper, 'AudioCallAlert'), 'play')

            await vi.advanceTimersByTimeAsync(3000)
            expect(play).toHaveBeenCalledTimes(3)

            await accepter(wrapper).trigger('click')
            await vi.advanceTimersByTimeAsync(30000)

            // Ce cas et le précédent sont la clôture du correctif de B2 : il réécrit la méthode
            // commune qui porte le `clearInterval`. Un correctif qui réparerait l'auto-refus en
            // cassant la sonnerie passerait sans eux.
            expect(play).toHaveBeenCalledTimes(3)
        })
    })

    describe('l\'auto-refus, une fois qu\'on a répondu', () => {

        it('⭐ accepter à 5 s n\'émet pas de refus à 20 s — répondre doit désarmer l\'auto-refus', async () => {
            wrapper = await monter('vocal')

            await vi.advanceTimersByTimeAsync(5000)
            await accepter(wrapper).trigger('click')

            // Garde-fou : l'acceptation est bien remontée. C'est ce qui fait que le rouge de ce cas
            // dit « un refus est arrivé après », et jamais « rien n'a été remonté ».
            expect(wrapper.emitted('response-alert')).toEqual([
                ['bob', invitation('vocal'), true],
            ])

            await vi.advanceTimersByTimeAsync(20000)

            // Le symptôme, à l'altitude où c'en est un : `Notifications.onResponseAlert` recevrait
            // une SECONDE réponse, de sens contraire, sur un appel déjà accepté — donc un
            // `acceptCallFromPeer({status: false})` qui ferme la session qu'on vient d'ouvrir.
            expect(wrapper.emitted('response-alert')).toEqual([
                ['bob', invitation('vocal'), true],
            ])
        })

        it('⭐ accepter à 2 s n\'émet pas de refus à 10 s — le même défaut, dans le jumeau VISIO', async () => {
            wrapper = await monter('visio')

            await vi.advanceTimersByTimeAsync(2000)
            await accepter(wrapper).trigger('click')

            expect(wrapper.emitted('response-alert')).toEqual([
                ['bob', invitation('visio'), true],
            ])

            await vi.advanceTimersByTimeAsync(10000)

            // Les deux fichiers sont identiques à quatre lignes près : un correctif appliqué à l'un
            // et pas à l'autre est le mode de panne le plus probable de ce lot — c'est exactement
            // ce qui était arrivé à B1, qui n'avait touché que la branche vocale.
            expect(wrapper.emitted('response-alert')).toEqual([
                ['bob', invitation('visio'), true],
            ])
        })

        it('refuser une fois n\'est pas doublé par le refus automatique', async () => {
            wrapper = await monter('vocal')

            await refuser(wrapper).trigger('click')
            await vi.advanceTimersByTimeAsync(30000)

            // Le refus manuel et le refus automatique disent la même chose ; les émettre deux fois
            // n'en est pas moins un défaut, et c'est le même. Ce cas dit que le correctif ne doit
            // pas se contenter de traiter l'acceptation.
            expect(wrapper.emitted('response-alert')).toHaveLength(1)
        })
    })

    describe('l\'auto-refus, une fois l\'alerte quittée', () => {

        it('⭐ démonter l\'alerte n\'y laisse AUCUN minuteur en attente — dans les deux alertes', async () => {
            for (const [type, nom] of [['vocal', 'AudioCallAlert'], ['visio', 'VideoCallAlert']]) {
                wrapper = await monter(type)
                expect(alerte(wrapper, nom).exists()).toBe(true)

                // Purge le minuteur de `delay` du composant asynchrone (200 ms, jamais annulé par
                // Vue — voir l'en-tête). Sans elle, le compte porterait un minuteur qui n'est pas
                // celui de l'alerte, et le démontage n'aurait aucune raison de le libérer.
                await vi.advanceTimersByTimeAsync(200)
                const avecAlerte = vi.getTimerCount()

                wrapper.unmount()
                wrapper = undefined

                // En DELTA autour du seul geste mesuré, jamais en absolu : ce qui est asserté est
                // que le démontage libère les DEUX minuteurs de l'alerte — la sonnerie ET
                // l'auto-refus —, quel que soit ce que la machinerie de Vue laisse traîner autour.
                expect(vi.getTimerCount()).toBe(avecAlerte - 2)
            }
        })

        it('⭐ vingt secondes après le démontage, plus aucun code de l\'alerte ne s\'exécute', async () => {
            wrapper = await monter('vocal')
            const pause = vi.spyOn(sonnerie(wrapper, 'AudioCallAlert'), 'pause')

            wrapper.unmount()
            wrapper = undefined

            // La positive AVANT la négative : `beforeUnmount` vient de passer par `ding.pause()`,
            // donc on a vu l'espion intercepter pour de vrai. Sans elle, un espion mal posé rendrait
            // la négative verte sans rien garder (règle 5 du paquet).
            expect(pause).toHaveBeenCalled()
            pause.mockClear()

            await vi.advanceTimersByTimeAsync(30000)

            // Ce que `getTimerCount` ne dit pas : le minuteur survivant n'est pas une fuite inerte,
            // il EXÉCUTE du code du composant — `onRefuseCall → stopAlert → ding.pause()` — sur une
            // instance détruite. Seule l'émission finale est avalée, et seulement par Vue.
            expect(pause).not.toHaveBeenCalled()
        })
    })

    describe('l\'auto-refus quand personne ne répond — ce qu\'il doit continuer de faire', () => {

        it('⭐ sans réponse, l\'alerte se refuse d\'elle-même : 20 s en VOCAL, 10 s en VISIO', async () => {
            const echeances = [
                ['vocal', 'AudioCallAlert', 20000, 10000],
                ['visio', 'VideoCallAlert', 10000, null],
            ]

            for (const [type, nom, echeance, echeanceDeLAutre] of echeances) {
                wrapper = await monter(type)
                expect(alerte(wrapper, nom).exists()).toBe(true)

                let ecoule = 0
                if (echeanceDeLAutre !== null) {
                    // L'ASYMÉTRIE, épinglée : à l'échéance de l'AUTRE alerte, celle-ci n'a encore
                    // rien dit. C'est ce qui interdit d'unifier les deux délais sans un rouge.
                    await vi.advanceTimersByTimeAsync(echeanceDeLAutre)
                    ecoule = echeanceDeLAutre
                    expect(wrapper.emitted('response-alert')).toBeUndefined()
                }

                // La paire `échéance - 1` / `échéance` interdit aussi bien de raccourcir le délai
                // que de l'allonger — la forme d'`usePeerTransport.iceRefresh.test.js`.
                await vi.advanceTimersByTimeAsync(echeance - 1 - ecoule)
                expect(wrapper.emitted('response-alert')).toBeUndefined()

                await vi.advanceTimersByTimeAsync(1)

                // ⭐ Le vert qui INTERDIT un correctif : supprimer le `setTimeout` rendrait les cinq
                // rouges de ce fichier verts d'un coup, en supprimant la fonctionnalité. Ce cas est
                // le seul des deux suites à épingler les deux échéances.
                expect(wrapper.emitted('response-alert')).toEqual([
                    ['bob', invitation(type), false],
                ])

                wrapper.unmount()
                wrapper = undefined
            }
        })
    })
})
