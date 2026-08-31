/**
 * AlertComponent.test.js — l'alerte d'appel entrant, et la réponse qu'elle remonte
 *
 * Vingt-quatre lignes utiles qui ne font que deux choses : **choisir** l'alerte selon
 * `options.type`, et **convertir** l'événement de l'alerte en `response-alert(slug, options,
 * bool)` à destination de `Notifications`. Un composant qui n'existe que pour convertir un
 * événement en appel ne se teste pas contre un stub : on asserterait le vocabulaire de son
 * propre double, et la conversion — la seule logique du fichier — ne serait vérifiée nulle part.
 *
 * ⚠️ **Les deux alertes sont montées POUR DE VRAI, et `IconWidget` (~estarter) aussi.**
 * « Vue ne se plaint jamais d'un événement que personne n'écoute — seul un montage réel le
 * voit » : un `@x` posé sur un enfant qui n'émet pas `x` ne produit **aucun** warning, Vue en fait
 * un écouteur DOM sur l'élément racine de l'enfant, où rien ne le déclenchera jamais. C'est
 * précisément le défaut que ce fichier a épinglé (B1, plus bas), et rien de moins qu'un montage
 * réel ne l'aurait vu — un stub aurait asserté le vocabulaire de son propre double.
 *
 * ⚠️ **Aucun import des deux alertes par leur chemin.** Elles sont atteintes par leur `name` et
 * par leur titre rendu — deux identités qu'un déplacement de fichier ne touche pas. C'est ce qui
 * fait que le lot C (`git mv` vers `WebRTC2/Widgets/UI/Alerts/`) n'aura à modifier **aucune ligne
 * de ce fichier** : sa preuve annoncée était « les tests de A/B verts sans autre modification que
 * le chemin d'import », elle est plus forte que ça.
 *
 * ⚠️ `await vi.dynamicImportSettled()`, et **pas** `flushPromises()` : les deux alertes sont des
 * `defineAsyncComponent`. Non résolues, elles sont un **nœud commentaire** — `findAll('button')`
 * rend `[]` et toute négative est vraie par vacuité. D'où le garde-fou du premier cas, qui
 * asserte la PRÉSENCE avant tout le reste. Mesuré chez le voisin
 * (`Notifications.callControls.test.js`, contrôle n° 9) : `flushPromises` ne résout pas un
 * `import()` dynamique, et n'ajoute rien derrière `dynamicImportSettled`.
 *
 * ⚠️ **Aucune `directives: { draggable }` en `global`** : elle serait INERTE, `v-draggable` étant
 * déclarée LOCALEMENT par `AlertComponent`. La vraie directive tourne donc, et ne fait rien —
 * `binding.value` est `undefined`, `options.draggable` est falsy, early-return.
 *
 * ⚠️ **Pas de stub `Audio`.** happy-dom l'implémente : `new Audio(url)` ne fait que poser
 * l'attribut `src` — aucune requête réseau — et `play()` est async et résout, donc aucun rejet
 * non traité. La sonnerie est coupée par `beforeUnmount` → `stopDing()`, d'où l'`afterEach`.
 *
 * ⚠️ **La DURÉE de ce fichier est une borne de correction, pas une statistique** : 1,1 s au
 * 2026-08-31 (259 ms de tests). Le `setTimeout` d'auto-refus des deux alertes n'est pas annulé au
 * démontage (défaut B2) : un fichier qui dépasserait 10 s verrait le timer d'un cas antérieur
 * émettre un refus pendant un cas ultérieur. Tant qu'on reste à ~1 s, la question ne se pose pas
 * — d'où ce chiffre, mesurable de nouveau.
 *
 * ⚠️ **Et B1 a ARMÉ ce risque sur la branche vocale** — fait relevé en le fermant. Avant, le timer
 * d'`AudioCallAlert` émettait `response-call` dans le vide : inoffensif. Depuis, il émet un vrai
 * refus, comme son jumeau visio le faisait déjà. Les deux alertes sont donc désormais également
 * concernées par B2, et la borne ci-dessus est ce qui garde la mesure honnête en attendant.
 *
 * ⚠️ `emitted()` capte AUSSI les événements DOM natifs qui remontent à la racine — un `click` à
 * chaque `trigger`, sur le wrapper parent COMME sur celui d'un enfant obtenu par
 * `findComponent`. Les écarter n'affaiblit rien : ce qui est asserté est le vocabulaire qu'un
 * parent peut écouter en `@…`.
 *
 * ── CE QUE CE FICHIER A ÉPINGLÉ : B1, fermé le 2026-08-31 ─────────────────────
 * Écrit rouge de trois cas, et vert au correctif sans qu'une assertion change. Il épinglait
 * `AudioCallAlert` émettant `response-call` quand son parent écoute `response-alert` et que son
 * jumeau `VideoCallAlert` émet bien `response-alert` — événement sans **aucun** écouteur dans le
 * paquet : sur un appel vocal entrant, « Accepter » et « Refuser » étaient morts.
 *
 * ⭐ **Ce qui reste après le correctif est une garde de non-régression, et elle est load-bearing.**
 * Le cas du vocabulaire contraignait la FORME de B1 — un seul vocabulaire pour les deux alertes,
 * pas un second écouteur `@response-call` chez le parent — et c'est cette forme qui garde les deux
 * alertes **interchangeables vues d'`AlertComponent`**, donc déplaçables au lot C. Le cas « un clic
 * n'émet qu'une réponse » ferme l'autre forme fautive : un parent qui écouterait les deux
 * vocabulaires émettrait deux fois. Les rétablir séparément recasse le lot C, pas ce fichier.
 *
 * ── HORS PÉRIMÈTRE, NOMMÉMENT ────────────────────────────────────────────────
 * • **les timers des deux alertes** (`pickedUp` jamais mis à `true`, handle du `setTimeout`
 *   d'auto-refus non stocké et non annulé au `beforeUnmount` — seul l'`interval` l'est) : lot
 *   **B2**, avec son propre harnais à faux timers. Rien ici n'appelle `vi.useFakeTimers()`,
 *   n'asserte sur les 20 s / 10 s, ni sur `ding` / `interval` / `pickedUp`.
 * • **`options.action` inconnu ⇒ TypeError au `created()`** (double déréférencement sans garde,
 *   `AlertComponent.vue:51`). Le garde existe **une couche plus haut** et il est déjà testé :
 *   `/send-alert-to-user` exige `options.action ∈ VALID_INVITE_ACTIONS`
 *   (`UserController.php:108,199-205`) et le PHP `ValidationTest` l'épingle en nommant ce
 *   déréférencement. Un cas ici serait soit un rouge qu'AUCUN lot ne referme — donc
 *   `hooks/pre-push` bloqué —, soit un constat qui DEMANDE au JS de ne jamais être durci. Item
 *   **B3** ouvert dans `work/doc-rustines.md`.
 * • le `type` hors des deux alertes, lui, est atteignable (`typeRules()` du backend accepte
 *   `data|stream|screen`) et ne lève pas : il est donc COUVERT ici.
 * • la divergence de contrat sur `fromUserSlug` — `default: null` chez `AlertComponent`,
 *   `required: true` chez les deux enfants : aucun cas ne passe `null`, la corriger serait un
 *   changement de comportement.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 * ⚠️ **Ces chiffres ont été mesurés AVANT B1, quand la référence n'était pas verte** : ce sont les
 * rouges TOTAUX du fichier sous mutation, et la référence en portait alors 3 ici · 1 dans
 * `Notifications.alerts.test.js` (seconde colonne). La référence est verte depuis B1 — mais **on ne
 * les convertit pas en écarts par soustraction**, et le n° 1 est la contre-épreuve : ses 10 rouges
 * incluaient les 3 de B1 *passés au vert par leurs symétriques visio*, donc son total ne baisse pas
 * de 3. Chaque conversion demande la mesure. Dette assumée : re-mesurer au prochain lot qui touche
 * ces fichiers — le lot C, qui les déplace.
 *
 *    1. mapping `vocal`/`visio` croisé ............................ 10 · 7
 *       ⚠️ la mutation reste presque totale mais pour une raison qui n'est pas « tout casse » :
 *          branchée sur l'autre type, chaque alerte répond correctement — ce qui rougit, c'est
 *          l'identité de l'alerte affichée, pas la réponse. Lire « presque tout le fichier ».
 *    2. `created()` vidé — `currentComponent` reste `null` ........ 11 · 7
 *    3. `@response-alert` retiré du `<component>` .................. 7 · 4
 *    4. `onResponseAlert` n'émet que `status` ...................... 6 · 3
 *    5. `:fromUserSlug` retiré du `<component>` .................... 6 · 2
 *    6. `:options` retiré du `<component>` ......................... 3 · 1   ← 0 écart
 *    7. `v-if="currentComponent"` retiré ........................... 3 · 1   ← 0 écart
 *    8. `v-draggable` retiré ....................................... 3 · 1   ← 0 écart
 *    9. l'attente d'asynchrone SUPPRIMÉE .......................... 11 · —
 *   10. `flushPromises` seul, au lieu de `dynamicImportSettled` .... 3 · —   ← 0 écart
 *   11. `flushPromises` ×4 ......................................... 3 · —   ← 0 écart
 *
 * **Les quatre 0, avec leur raison** — aucun n'est « la ligne est inutile » :
 *
 * • **n° 6** : les deux alertes déclarent `options` `required` et **ne la lisent jamais**. La
 *   prop est relayée pour rien. Constat conservé plutôt que corrigé : le bon moment pour la
 *   couper est le lot C, quand les deux fichiers déménagent (candidate sortie B).
 * • **n° 7** : `<component :is="undefined">` ne rend rien **et ne lève pas** — Vue absorbe la
 *   mutation, le `v-if` est une ceinture sur une bretelle. Il reste : il dit l'intention au
 *   lecteur, et c'est lui qui rend le cas « un type hors des deux alertes » lisible.
 * • **n° 8** : ce que fait la directive n'est observable dans **aucun** des deux runners —
 *   happy-dom ne calcule aucune mise en page, et faute de valeur de binding elle sort en
 *   early-return (`draggable.js:3-4`). Le 0 est noté pour ne pas être re-mesuré.
 * • **n° 10 et 11, et c'est le seul qui surprend** : le **choix de l'outil** n'est pas discriminé
 *   DANS CE FICHIER. Un seul niveau d'asynchrone et une chaîne de modules courte (l'alerte
 *   n'importe qu'`IconWidget`) : une macrotâche suffit, donc `flushPromises` passe. Ce qui est
 *   discriminé, c'est **qu'il y ait une attente** — n° 9, onze rouges sur douze. ⚠️ **N'en
 *   conclure surtout pas que `flushPromises` fait l'affaire** : deux niveaux plus loin, dans
 *   `Notifications.alerts.test.js`, quatre tours de `flushPromises` laissent 2 cas rouges (son
 *   contrôle n° 11), et le voisin `Notifications.callControls.test.js` l'avait mesuré à 6 sur 7.
 *   La profondeur de la chaîne de modules décide — donc l'outil déterministe reste la règle.
 *
 * ⭐ **Ce que ce fichier ne peut PAS voir, et qui justifie son jumeau** : les huit contrôles de
 * couture de `Notifications.alerts.test.js` (l'écouteur `.AlertToUser`, les props relayées,
 * l'attribut `@response-alert` du parent, le verbe atteint) rougissent là-bas et **0 cas ici**.
 * La réciproque n'est pas vraie, et il faut le dire : les mutations d'`AlertComponent.vue`
 * rougissent les DEUX fichiers, puisque l'autre monte le composant réel. C'est la colonne de
 * couture qui vaut le second fichier, pas une symétrie.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AlertComponent from '~socializer/components/System/widgets/AlertComponent.vue'

// ─── Harnais ─────────────────────────────────────────────────────────────────

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
 * Monte l'alerte et **attend la résolution du composant asynchrone**.
 * Sans `dynamicImportSettled`, l'alerte est un nœud commentaire — voir l'en-tête.
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
const titre = (w) => w.find('.alert-heading').text()

/** Le vocabulaire qu'un parent peut écouter en `@…` — sans le bouillonnement DOM. */
const vocabulaire = (w) => Object.keys(w.emitted()).filter((e) => e !== 'click').sort()

let wrapper

afterEach(() => {
    // Coupe la sonnerie (`beforeUnmount` → `stopDing`). ⚠️ Le `setTimeout` d'auto-refus, lui,
    // n'est PAS annulé — c'est le défaut du lot B2, pas une faute de ce harnais. Sous timers
    // réels il ne se déclencherait qu'après 10 s (visio) / 20 s (vocal), et l'`abort()` de
    // teardown de l'environnement happy-dom l'emporte en fin de fichier.
    wrapper?.unmount()
    wrapper = undefined
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AlertComponent — l\'alerte d\'appel entrant et la réponse qu\'elle remonte', () => {

    it('⭐ l\'alerte est réellement montée, avec ses deux boutons — le garde-fou de tout ce fichier', async () => {
        wrapper = await monter('visio')

        // Sans ce cas, un `dynamicImportSettled` oublié rendrait tous les autres verts par
        // vacuité : un composant asynchrone non résolu est un nœud commentaire, et toute
        // recherche dans le DOM y répond « absent » sans erreur.
        expect(alerte(wrapper, 'VideoCallAlert').exists()).toBe(true)
        expect(wrapper.findAll('button')).toHaveLength(2)
        expect(accepter(wrapper).exists()).toBe(true)
        expect(refuser(wrapper).exists()).toBe(true)
    })

    describe('quelle alerte s\'affiche', () => {

        it('⭐ une invitation « visio » affiche l\'alerte vidéo, et pas la vocale', async () => {
            wrapper = await monter('visio')

            expect(alerte(wrapper, 'VideoCallAlert').exists()).toBe(true)
            expect(alerte(wrapper, 'AudioCallAlert').exists()).toBe(false)
            expect(titre(wrapper)).toContain('Appel video de bob')
        })

        it('⭐ une invitation « vocal » affiche l\'alerte vocale, et pas la vidéo', async () => {
            wrapper = await monter('vocal')

            // Le montage vocal fonctionne : ce qui est mort, c'est seulement la réponse — voir
            // le `describe` de la branche vocale plus bas.
            expect(alerte(wrapper, 'AudioCallAlert').exists()).toBe(true)
            expect(alerte(wrapper, 'VideoCallAlert').exists()).toBe(false)
            expect(titre(wrapper)).toContain('Appel vocal de bob')
        })

        it('l\'alerte nomme l\'appelant : c\'est la seule information qu\'elle porte', async () => {
            // `options` est relayée aux deux alertes, qui ne la lisent jamais. Le slug est donc
            // le seul contenu variable de l'écran, et le seul dont l'utilisateur dispose pour
            // décider s'il décroche.
            wrapper = await monter('vocal', 'carole')
            expect(titre(wrapper)).toContain('carole')

            wrapper.unmount()
            wrapper = await monter('visio', 'carole')
            expect(titre(wrapper)).toContain('carole')
        })

        it('un type d\'invitation hors des deux alertes n\'affiche rien, et ne lève pas', async () => {
            // `screen` passe la validation du backend (`typeRules()` accepte
            // data|stream|screen|visio|vocal) alors que `mappingComponents` ne connaît que
            // vocal et visio : le double déréférencement rend `undefined`, le `v-if` retient le
            // rendu, et rien ne lève. Asymétrie assumée avec un `action` inconnu, qui LÈVE — et
            // que le backend, lui, refuse en 422 (voir l'en-tête, item B3).
            wrapper = await monter('screen')

            expect(alerte(wrapper, 'AudioCallAlert').exists()).toBe(false)
            expect(alerte(wrapper, 'VideoCallAlert').exists()).toBe(false)
            expect(wrapper.findAll('button')).toHaveLength(0)
            expect(wrapper.emitted('response-alert')).toBeUndefined()
        })
    })

    describe('répondre à l\'invitation', () => {

        it('⭐ « Accepter » remonte response-alert(slug, options, true)', async () => {
            wrapper = await monter('visio')

            await accepter(wrapper).trigger('click')

            // Les trois arguments, dans cet ordre : c'est la signature qu'attend
            // `Notifications.onResponseAlert(fromUserSlug, options, status)`. Une réponse qui
            // arriverait avec deux arguments ferait entrer le `switch` sur `undefined.action`.
            expect(wrapper.emitted('response-alert')).toEqual([
                ['bob', invitation('visio'), true],
            ])
        })

        it('⭐ « Refuser » remonte response-alert(slug, options, false)', async () => {
            wrapper = await monter('visio')

            await refuser(wrapper).trigger('click')

            expect(wrapper.emitted('response-alert')).toEqual([
                ['bob', invitation('visio'), false],
            ])
        })

        it('l\'alerte remonte les options REÇUES, sans en réécrire une', async () => {
            wrapper = await monter('visio')

            await accepter(wrapper).trigger('click')

            // Les cinq clés sont ce que `acceptCallFromPeer` consomme en aval : `type` choisit
            // le flux local (un appel vocal n'ouvre pas la caméra), `peerId` est le mapping
            // d'autorisation entrante, `inviteId` arrête le moteur de retry chez l'appelant.
            // En perdre une en route ne casse rien visiblement — ça casse l'appel.
            const [, optionsRemontees] = wrapper.emitted('response-alert')[0]
            expect(optionsRemontees).toEqual({
                type: 'visio',
                action: 'peer-access-permission',
                room: 'call-room-1',
                peerId: '00000000-0000-4000-8000-000000000001',
                inviteId: 'invite-1',
            })
        })

        it('un clic n\'émet qu\'une réponse, jamais deux', async () => {
            wrapper = await monter('visio')

            await accepter(wrapper).trigger('click')

            // Ce cas ferme la seconde forme fautive qu'aurait pu prendre le correctif B1 : un
            // parent qui écouterait les DEUX vocabulaires sur une alerte qui les émettrait tous
            // les deux remonterait deux réponses pour un clic — donc deux `acceptCallFromPeer`,
            // dont le second sur une session déjà ouverte.
            expect(wrapper.emitted('response-alert')).toHaveLength(1)
        })
    })

    describe('la branche VOCALE — ce que B1 a fermé', () => {

        it('⭐ « Accepter » sur un appel VOCAL remonte response-alert(…, true)', async () => {
            wrapper = await monter('vocal')

            // Garde-fou avant l'assertion qui compte : l'alerte vocale est bien montée et son
            // bouton est bien là. C'est ce qui a fait que le rouge de ce cas disait « rien n'a été
            // remonté », et jamais « bouton introuvable ».
            expect(alerte(wrapper, 'AudioCallAlert').exists()).toBe(true)

            await accepter(wrapper).trigger('click')

            expect(wrapper.emitted('response-alert')).toEqual([
                ['bob', invitation('vocal'), true],
            ])
        })

        it('⭐ « Refuser » sur un appel VOCAL remonte response-alert(…, false)', async () => {
            wrapper = await monter('vocal')

            expect(alerte(wrapper, 'AudioCallAlert').exists()).toBe(true)

            await refuser(wrapper).trigger('click')

            // Le refus n'est pas moins grave que l'acceptation : c'est lui qui ramène la FSM de
            // l'appelant à IDLE. Perdu, l'appelant reste en 'calling' jusqu'à l'abandon du
            // moteur de retry.
            expect(wrapper.emitted('response-alert')).toEqual([
                ['bob', invitation('vocal'), false],
            ])
        })
    })

    describe('le vocabulaire d\'événements des deux alertes', () => {

        it('⭐ chaque alerte n\'émet que « response-alert »', async () => {
            // L'énumération exacte remplace l'assertion négative : elle rougit aussi bien si un
            // second nom d'événement apparaît que si `response-alert` disparaît. C'est elle qui a
            // NOMMÉ la cause de B1 — `AudioCallAlert` parlait un vocabulaire que personne
            // n'écoutait — là où les deux cas de la branche vocale n'en montraient que l'effet.
            // Elle garde désormais l'invariant qui rend les deux alertes interchangeables.
            for (const [type, nom] of [['vocal', 'AudioCallAlert'], ['visio', 'VideoCallAlert']]) {
                const w = await monter(type)
                const enfant = alerte(w, nom)

                await enfant.find('.btn-success').trigger('click')
                await enfant.find('.btn-danger').trigger('click')

                expect(vocabulaire(enfant)).toEqual(['response-alert'])

                w.unmount()
            }
        })
    })
})
