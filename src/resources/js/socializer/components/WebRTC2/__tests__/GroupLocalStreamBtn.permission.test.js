/**
 * GroupLocalStreamBtn.permission.test.js
 *
 * Ce qu'un utilisateur voit quand un démarrage de flux échoue — le cas le plus courant d'un
 * premier usage : il refuse la permission caméra, ou n'a aucun périphérique.
 *
 * ── Ce que ce fichier ferme ───────────────────────────────────────────────────
 *
 * La moitié UI d'un défaut dont la moitié basse était déjà faite. `useMediaBroadcast`
 * **rendait** la promesse des trois démarrages (l. 180-196, épinglé par
 * `useMediaBroadcast.test.js` § démarrages de flux) — mais personne ne l'attrapait :
 * `usePeerMedia` appelle `getUserMedia`/`getDisplayMedia` nus (l. 45, 63, 77), l'orchestrateur
 * les `await` nus, et ce panneau appelait les trois verbes sans `await` ni `.catch`. Le rejet
 * partait en « unhandled rejection » : pas de toast, pas de changement d'état — `isStreaming`
 * reste faux par simple non-exécution du code post-`await` — et un bouton qui semble mort,
 * indistinguable d'une panne réseau.
 *
 * ── Les trois décisions que ce fichier épingle ────────────────────────────────
 *
 *   1. **`inject('AWN', null)` AVEC repli sur `window.AWN`.** Le précédent suivi est
 *      `MediaBroadcastProvider.vue:39` (`inject(REVERB_CHANNEL, null)`, « optionnel par
 *      contrat »), **pas** `CallRemotePeerBtn.vue:31` qui injecte sans repli : le module monte
 *      aussi des sous-apps par `createApp()` (`usePeerMedia.js:118`) qui ne fournissent pas
 *      `AWN`. Un `inject` dur transformerait un refus de permission en un second crash.
 *   2. **Le message porte `err.name`**, et `NotAllowedError` est distingué de `NotFoundError` :
 *      les deux appellent des gestes OPPOSÉS de l'utilisateur (ré-autoriser vs brancher). Seul
 *      endroit du dépôt qui le faisait déjà : `callbacks/visioPlayerCallback.js:90`, dans la
 *      v1 — c'est ce que WebRTC2 avait perdu.
 *   3. **Silence sur `NotAllowedError` pour `startCapture` SEULEMENT.** `getDisplayMedia`
 *      rejette avec le même `NotAllowedError` que l'utilisateur refuse la permission ou qu'il
 *      ferme simplement le sélecteur de partage : les deux sont indiscernables, et notifier à
 *      chaque fois qu'on se ravise serait du bruit. Décision du 2026-08-30, pas un oubli.
 *
 * **Non-objectifs, à ne pas croire oubliés** : aucun état réactif d'erreur, aucun `isLoading`.
 * Le panneau notifie et s'arrête là.
 *
 * ── ⚠️ Deux corrections d'énoncé, trouvées en écrivant ce fichier ─────────────
 *
 *   1. **Ce n'était pas un « rejet non traité » au sens de Node.** Le handler du panneau
 *      (`startWebcamStream`) appelait le verbe **sans rendre** sa promesse, et les émetteurs
 *      de `LocalStreamBtn` ne rendent rien non plus : Vue ne voyait donc jamais de promesse
 *      et `callWithAsyncErrorHandling` n'avait rien à rattraper. Mesuré : ni
 *      `app.config.errorHandler`, ni `console.error`, ni `process.on('unhandledRejection')`
 *      ne voyaient quoi que ce soit. Le symptôme décrit par l'item restait exact — pas de
 *      toast, pas de changement d'état, un bouton mort — mais l'erreur disparaissait **sans
 *      la moindre trace**, ce qui est pire que ce qui était écrit.
 *
 *   2. **La question « le rejet s'échappe-t-il ? » est INTESTABLE à travers un espion, et le
 *      cas qui la posait a été supprimé plutôt que commenté** (précédent `isValidSlug`).
 *      Mesuré côte à côte dans le même test : un `Promise.reject()` nu déclenche bien
 *      `unhandledRejection`, celui d'un `vi.fn().mockRejectedValue()` **jamais** — l'espion
 *      attache son propre handler pour tracer ses résultats et absorbe le signal. Un cas
 *      assertant « aucun rejet ne s'échappe » aurait donc été vert par construction, avant
 *      comme après le correctif. Ce qui reste testable est ce qui compte pour l'utilisateur :
 *      **un toast apparaît**, et c'est ce que couvrent les cas ci-dessous.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-30 ────────
 *
 *    1. le `.catch` de `startWebcamStream` retiré SEUL ................... 3 cas
 *    2. le `.catch` de `startAudioStream` retiré SEUL .................... 1 cas
 *    3. le `.catch` de `startScreenCapture` retiré SEUL .................. 1 cas
 *    4. les TROIS `.catch` retirés (l'état d'avant le correctif) ......... 5 cas
 *    5. `err.name` retiré du message .................................... 4 cas
 *    6. les deux explications fusionnées en une seule ................... 1 cas
 *    7. la discrimination `NotAllowedError` de `startCapture` retirée ... 1 cas
 *    8. `inject('AWN', null)` remplacé par un `inject('AWN')` nu ......... 1 cas
 *
 * ⚠️ Les n° 1 à 3 sont mesurés **un par un** en plus du n° 4 : ce sont trois points d'attache
 * indépendants, et un `.catch` oublié sur un seul des trois se cacherait derrière ses voisins
 * dans une mesure groupée. Leur somme (3+1+1) égale exactement le n° 4 — chaque verbe porte
 * bien sa part, aucun n'est couvert deux fois ni pas du tout.
 *
 * ⚠️ **Les n° 6 et 8 ont d'abord rougi ZÉRO cas, et les deux fois la faute était dans ce
 * fichier**, pas dans le code :
 *   - n° 6 : le cas n'assertait que « les deux messages diffèrent », ce que le préfixe
 *     `err.name` garantit à lui seul. Fusionner les deux explications restait vert. Il asserte
 *     désormais le GESTE indiqué, qui est opposé dans les deux cas ;
 *   - n° 8 : il n'y avait rien à garder. Un `inject('AWN')` nu ne plante pas, il rend
 *     `undefined`, et le repli `?? window.AWN` fonctionne à l'identique. Le défaut `null`
 *     n'évite qu'un avertissement Vue — c'est ce que le dernier cas asserte maintenant, et
 *     c'est tout ce qu'il vaut. Le commentaire du composant affirmait un plantage : corrigé.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GroupLocalStreamBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/GroupLocalStreamBtn.vue'
import { createMediaApiDouble } from './helpers/createMediaApiDouble.js'

const refus = () => new DOMException('Permission denied', 'NotAllowedError')
const aucunPeripherique = () => new DOMException('Requested device not found', 'NotFoundError')
const materielOccupe = () => new DOMException('Could not start source', 'NotReadableError')

let api
let awnGlobal

const monter = ({ etatInitial, awnInjecte = null } = {}) => {
    api = createMediaApiDouble(etatInitial)

    return mount(GroupLocalStreamBtn, {
        props: { api },
        global: awnInjecte ? { provide: { AWN: awnInjecte } } : {},
    })
}

const items = (w) => w.findAll('.dropdown-item')
const boutonPartage = (w) => w.findAll('button').find((b) => b.text().includes('artage'))

/** Laisse le rejet traverser les microtâches ET une tâche, comme en production. */
const laisserRetomber = () => new Promise((r) => setTimeout(r, 0))

const messages = () => awnGlobal.alert.mock.calls.map((c) => String(c[0])).join('\n')

describe('GroupLocalStreamBtn — échec du démarrage d\'un flux', () => {

    beforeEach(() => {
        // Voie globale, précédent `Notifications.test.js:110`. La voie injectée est exercée
        // par le dernier cas, avec son propre espion.
        awnGlobal = { alert: vi.fn(), info: vi.fn() }
        window.AWN = awnGlobal
    })

    afterEach(() => {
        delete window.AWN
    })

    describe('l\'utilisateur est prévenu', () => {
        it('⭐ un refus de permission caméra se voit à l\'écran', async () => {
            const w = monter()
            api.getWebcamStream.mockRejectedValueOnce(refus())

            await items(w)[0].trigger('click')
            await laisserRetomber()

            expect(awnGlobal.alert).toHaveBeenCalledTimes(1)
            expect(messages()).toContain('NotAllowedError')
        })

        it('un refus de permission micro se voit aussi', async () => {
            // Deux verbes, et non un : un `.catch` posé sur le seul chemin webcam laisserait
            // ce cas rouge, et un test qui n'exercerait que la webcam serait vert avec deux
            // tiers du défaut intacts.
            const w = monter()
            api.getAudioStream.mockRejectedValueOnce(refus())

            await items(w)[1].trigger('click')
            await laisserRetomber()

            expect(awnGlobal.alert).toHaveBeenCalledTimes(1)
            expect(messages()).toContain('NotAllowedError')
        })

        it('un partage d\'écran qui échoue techniquement se voit', async () => {
            const w = monter()
            api.startCapture.mockRejectedValueOnce(materielOccupe())

            await boutonPartage(w).trigger('click')
            await laisserRetomber()

            expect(awnGlobal.alert).toHaveBeenCalledTimes(1)
            expect(messages()).toContain('NotReadableError')
        })

        it('⭐ le message nomme la cause, et deux causes ne disent pas la même chose', async () => {
            // Deux erreurs, et non une : avec une seule, « le message nomme la cause » et
            // « le message est une constante » donnent exactement le même vert. Or les deux
            // causes appellent des gestes opposés — ré-autoriser, ou brancher un périphérique.
            const refuse = monter()
            api.getWebcamStream.mockRejectedValueOnce(refus())
            await items(refuse)[0].trigger('click')
            await laisserRetomber()
            const messageRefus = String(awnGlobal.alert.mock.calls.at(-1)[0])

            awnGlobal.alert.mockClear()

            const sansCamera = monter()
            api.getWebcamStream.mockRejectedValueOnce(aucunPeripherique())
            await items(sansCamera)[0].trigger('click')
            await laisserRetomber()
            const messageAbsence = String(awnGlobal.alert.mock.calls.at(-1)[0])

            expect(messageRefus).toContain('NotAllowedError')
            expect(messageAbsence).toContain('NotFoundError')

            // ⚠️ Asserter seulement que les deux messages DIFFÈRENT ne prouverait rien : le
            // préfixe `err.name` suffit à les rendre différents, et fusionner les deux
            // explications restait vert (mesuré : contrôle n° 6 à 0 cas). Ce qui compte pour
            // l'utilisateur est le GESTE indiqué, et il est opposé dans les deux cas.
            expect(messageRefus).toMatch(/autorisez/i)
            expect(messageAbsence).toMatch(/aucun périphérique/i)
        })

        it('aucun toast quand tout se passe bien', async () => {
            const w = monter()

            await items(w)[0].trigger('click')
            await boutonPartage(w).trigger('click')
            await laisserRetomber()

            expect(awnGlobal.alert).not.toHaveBeenCalled()
        })
    })

    describe('annuler le partage d\'écran n\'est pas une erreur', () => {
        it('⭐ fermer le sélecteur de partage ne dit rien', async () => {
            // `getDisplayMedia` rejette avec `NotAllowedError` aussi bien sur un refus que sur
            // une simple fermeture du sélecteur : indiscernables. Se raviser est un geste
            // normal, le notifier serait du bruit. Décision assumée, et c'est le SEUL cas où
            // un `NotAllowedError` reste silencieux.
            const w = monter()
            api.startCapture.mockRejectedValueOnce(refus())

            await boutonPartage(w).trigger('click')
            await laisserRetomber()

            expect(awnGlobal.alert).not.toHaveBeenCalled()
        })
    })

    describe('ce que l\'échec ne fait pas', () => {
        it('un échec ne fait pas croire que la diffusion a commencé', async () => {
            const w = monter()
            api.getWebcamStream.mockRejectedValueOnce(refus())

            await items(w)[0].trigger('click')
            await laisserRetomber()

            // `isStreaming` n'a jamais été mis à vrai : le code qui l'écrit est en aval du
            // `await` qui rejette. Le panneau doit donc toujours proposer de démarrer.
            expect(w.find('#stop-stream-btn').exists()).toBe(false)
            expect(items(w)).toHaveLength(2)
        })
    })

    describe('où le panneau trouve de quoi notifier', () => {
        it('⭐ il préfère le notifieur injecté, et retombe sur window.AWN sinon', async () => {
            // Deux sources, et non une : avec une seule, « prend l'injecté » et « prend
            // toujours window » sont indistinguables. Le repli n'est pas décoratif — les
            // sous-apps montées par `createApp()` (usePeerMedia.js:118) ne fournissent rien.
            const awnInjecte = { alert: vi.fn(), info: vi.fn() }

            const avecInjection = monter({ awnInjecte })
            api.getWebcamStream.mockRejectedValueOnce(refus())
            await items(avecInjection)[0].trigger('click')
            await laisserRetomber()

            expect(awnInjecte.alert).toHaveBeenCalledTimes(1)
            expect(awnGlobal.alert).not.toHaveBeenCalled()

            const sansInjection = monter()
            api.getWebcamStream.mockRejectedValueOnce(refus())
            await items(sansInjection)[0].trigger('click')
            await laisserRetomber()

            expect(awnGlobal.alert).toHaveBeenCalledTimes(1)
        })

        it('monter sans fournisseur d\'AWN n\'est pas un incident', () => {
            // ⚠️ Ce que fait VRAIMENT le défaut `null` d'`inject('AWN', null)`, mesuré : il
            // n'évite aucun plantage — un `inject('AWN')` nu rend `undefined`, et le repli
            // `?? window.AWN` fonctionne identiquement (contrôle n° 8 : 0 cas avant ce
            // cas-ci). Ce qu'il évite est un « injection "AWN" not found » de Vue à CHAQUE
            // montage sur un chemin où l'absence est normale — les sous-apps montées par
            // `createApp()` dans `usePeerMedia` ne fournissent pas `AWN`. Sans cette
            // assertion, le `, null` n'était gardé par rien.
            const avertissements = []
            const espion = vi.spyOn(console, 'warn')
                .mockImplementation((m) => avertissements.push(String(m)))

            try {
                monter()
            } finally {
                espion.mockRestore()
            }

            expect(avertissements.join('\n')).not.toMatch(/injection .*AWN.* not found/i)
        })
    })
})
