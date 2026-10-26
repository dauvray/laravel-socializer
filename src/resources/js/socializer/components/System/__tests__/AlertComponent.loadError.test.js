/**
 * AlertComponent.loadError.test.js — une alerte dont le chunk ne se charge pas se refuse d'office
 *
 * Fichier séparé parce que `vi.mock` vaut pour TOUT le fichier : ici, l'`import()` de
 * `VideoCallAlert` REJETTE toujours — la factory lève —, et celui d'`AudioCallAlert` PEND toujours —
 * la factory rend une promesse qui ne se règle jamais. Les deux pannes d'un chunk, une par alerte.
 *
 * ⚠️ **Le déclencheur réel est un déploiement**, pas un réseau capricieux : un onglet ouvert avant
 * lui garde le manifeste d'avant, donc des noms de chunk hachés que l'image neuve ne sert plus, et
 * rien dans l'hôte n'écoute `vite:preloadError`. Le premier appel entrant après le déploiement
 * charge l'alerte pour la première fois — et échoue.
 *
 * ── CE QUE CE FICHIER A ÉPINGLÉ, le 2026-10-26 ─────────────────────────────────
 * Écrit rouge d'un cas, trouvé par la relecture du lot B. Sans `errorComponent`, le wrapper
 * asynchrone en échec ne rend RIEN et reste monté : aucune sonnerie, aucun minuteur d'auto-refus (ils
 * naissent dans le `mounted()` de l'alerte), aucune réponse à l'appelant — et le repli de B3 ne le
 * voyait pas, `currentComponent` valant la CHAÎNE `'VideoCallAlert'`, vraie. Côté `Notifications`, le
 * créneau restait pris pour la vie de l'onglet, et le garde « occupé » de B5 refusait tous les
 * appelants suivants avec un toast qui parlait d'un appel que personne ne voyait.
 * La couture — un `response-alert(…, false)` libère le créneau — est déjà épinglée dans
 * `Notifications.alerts.test.js` (describe B3) : ce fichier n'a à prouver que l'émission.
 *
 * ⚠️ **Le chunk qui PEND est le second trou, trouvé par la même relecture** : un `errorComponent` seul
 * ne l'atteint jamais, seul le `timeout` du wrapper y mène (`ALERT_LOAD_TIMEOUT_MS`). Son cas tourne
 * sous horloge factice, et SANS `vi.dynamicImportSettled()` — qui attendrait l'import pendu pour
 * toujours.
 *
 * ── CONTRÔLES, mesurés le 2026-10-26 sur les sept fichiers de `System/__tests__` ────
 * Rouges de CE fichier sous mutation ; zéro dans les six autres.
 *    M10. `errorComponent` retiré de `asyncCallAlert` ............. 2
 *    M12. `CallAlertUnavailable` monté sans émettre ............... 2
 *    M14. `timeout` retiré de `asyncCallAlert` .................... 1   (le cas « pendu »)
 *    H1.  le mock « pendu » d'`AudioCallAlert` rejette au lieu de pendre ... 1   (« pas avant »)
 *
 * ℹ️ Vue journalise l'échec du chargeur — un `console.warn` « Unhandled error during execution of async
 * component loader », puis l'erreur en `console.error` — et, avec un `errorComponent`, ne LÈVE plus en
 * dev, c'est tout (sans lui : rejet non géré, que Vitest compte en erreur). Les deux sorties console
 * sont donc rendues muettes ici, et seul l'avertissement du repli est asserté.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { ALERT_LOAD_TIMEOUT_MS } from '~socializer/components/System/system.config.js'

vi.mock('~socializer/components/WebRTC2/Widgets/UI/Alerts/VideoCallAlert.vue', () => {
    throw new Error('chunk VideoCallAlert introuvable (simulé)')
})

vi.mock('~socializer/components/WebRTC2/Widgets/UI/Alerts/AudioCallAlert.vue', () => new Promise(() => {}))

import AlertComponent from '~socializer/components/System/widgets/AlertComponent.vue'

const invitation = (type) => ({
    type,
    action: 'peer-access-permission',
    room: 'call-room-1',
    peerId: '00000000-0000-4000-8000-000000000001',
    inviteId: 'invite-1',
})

/** Monte, puis laisse le chargeur rejeter, le composant d'erreur se rendre et son `mounted()` émettre. */
const monter = async (type) => {
    const w = mount(AlertComponent, { props: { fromUserSlug: 'bob', options: invitation(type) } })
    await vi.dynamicImportSettled()
    await flushPromises()
    await nextTick()
    return w
}

let wrapper
let espionWarn

beforeEach(() => {
    espionWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('AlertComponent — une alerte dont le chunk ne se charge pas', () => {

    it('⭐ elle se refuse d\'office : response-alert(slug, options, false), sans rien afficher', async () => {
        wrapper = await monter('visio')

        expect(wrapper.findAll('button')).toHaveLength(0)
        expect(wrapper.emitted('response-alert')).toEqual([['bob', invitation('visio'), false]])
        // Le repli le dit, une fois. ⚠️ Pas `toHaveBeenCalledTimes` sur `console.warn` : Vue y écrit
        // aussi son propre « Unhandled error during execution of async component loader ».
        const avertissementsDuRepli = espionWarn.mock.calls.filter(([message]) => String(message).startsWith('[AlertComponent]'))
        expect(avertissementsDuRepli).toHaveLength(1)
    })

    it('⭐ un chunk qui PEND est refusé au bout d\'ALERT_LOAD_TIMEOUT_MS, et pas avant', async () => {
        vi.useFakeTimers()
        wrapper = mount(AlertComponent, { props: { fromUserSlug: 'bob', options: invitation('vocal') } })
        await flushPromises()

        // « Pas avant » est le garde-fou du harnais autant que du code : un mock qui rejetterait au
        // lieu de pendre ferait émettre ici, tout de suite.
        await vi.advanceTimersByTimeAsync(ALERT_LOAD_TIMEOUT_MS - 1)
        expect(wrapper.emitted('response-alert')).toBeUndefined()

        await vi.advanceTimersByTimeAsync(1)
        await nextTick()

        expect(wrapper.findAll('button')).toHaveLength(0)
        expect(wrapper.emitted('response-alert')).toEqual([['bob', invitation('vocal'), false]])
    })
})
