/**
 * WhiteboardComponent.connectionOpen.test.js
 * Périmètre : le renvoi de la scène à un arrivant — `handleConnectionOpen`.
 *
 * ── Ce que ce fichier tient ───────────────────────────────────────────────────
 *
 * Le renvoi de scène est ce qui fait qu'un arrivant voit le tableau déjà tracé, et il a
 * trois propriétés qu'aucun test ne tenait avant le 01/09/2026 :
 *
 *   1. il part sur la connexion REÇUE (`sendDataOnConnection`), et non par une résolution
 *      par slug (`sendData`) — laquelle ne connaît que les connexions SORTANTES, donc ne
 *      trouvait rien et laissait le tableau de l'arrivant VIDE ;
 *   2. il ne part QUE sur une connexion entrante : `onConnectionOpen` tire dans les deux
 *      sens et, en mesh, chaque paire a deux connexions ;
 *   3. il ne part PAS sur un tableau enregistrable, où l'arrivant charge du serveur.
 *
 * ⚠️ Le cas 1 est le seul qui distingue le code corrigé du code fautif : les deux gardes
 * étaient déjà là, c'est le VÉHICULE qui était faux. C'est donc l'assertion « `sendData`
 * n'est pas appelé » qui porte la régression, pas celles sur les gardes.
 *
 * ── Pièges de harnais assumés ─────────────────────────────────────────────────
 *
 * - `ExcalidrawElement.jsx` est mocké : son import est un EFFET DE BORD (il appelle
 *   `customElements.define`) et il tirerait React + tout Excalidraw dans happy-dom. On
 *   définit à sa place un élément custom minimal, ce qui donne en prime la main sur
 *   `getSceneElements` / `getFiles`.
 * - Ce faux élément porte un vrai `shadowRoot` peuplé de `.SVGLayer` et du footer :
 *   `mounted()` y pose deux `setTimeout` qui les cherchent, et les faux timers de ces tests
 *   les font tirer. Sans le shadow, ils lèveraient.
 * - `RoomUsersList` est asynchrone (`defineAsyncComponent`) : il est stubé, jamais résolu —
 *   un composant asynchrone ne se résout pas avec `flushPromises`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { useMeStore } from '~estarter/stores/me.js'
import { useServerStore } from '~socializer/stores/server.js'

// Effet de bord uniquement : on l'empêche de définir l'élément custom et d'importer React.
vi.mock('~socializer/components/Whiteboard/ExcalidrawElement.jsx', () => ({}))

import WhiteboardComponent from '~socializer/components/Whiteboard/WhiteboardComponent.vue'

const ME = { slug: 'alice', name: 'Alice' }
const PEER = 'bob'

let sceneElements
let sendData
let sendDataOnConnection

// L'élément custom que `mounted()` et les deux émetteurs interrogent.
class FakeExcalidrawElement extends HTMLElement {
    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        // Les deux nœuds que `mounted()` va chercher dans le shadow.
        const svgLayer = document.createElement('div')
        svgLayer.className = 'SVGLayer'
        const footer = document.createElement('div')
        footer.className = 'layer-ui__wrapper__footer-right'
        shadow.appendChild(svgLayer)
        shadow.appendChild(footer)
    }

    getSceneElements() {
        return sceneElements
    }

    getFiles() {
        return {}
    }

    getAppState() {
        // Ce que le défaut du 31/08 a mordu : une Map, sur laquelle BinaryPack lève. Elle
        // est ici pour que le test soit rouge si quelqu'un remet l'appState dans le payload.
        return { collaborators: new Map() }
    }

    updateScene() {}
}

if (!customElements.get('excalidraw-element')) {
    customElements.define('excalidraw-element', FakeExcalidrawElement)
}

/**
 * @param {Object} [options]
 * @param {number|null} [options.saveBoard]  Valeur de `save_board` sur la room.
 * @returns {import('@vue/test-utils').VueWrapper}
 */
const mountWhiteboard = ({ saveBoard = null } = {}) => {
    const meStore = useMeStore()
    meStore.user = { ...ME }

    const serverStore = useServerStore()
    // Le chemin enregistrable appelle une action AJAX dès `created()` : neutralisée ici,
    // AjaxService lirait un jeton CSRF absent du DOM de test.
    //
    // ⚠️ La valeur résolue est une scène VALIDE, et ce n'est pas un détail de confort :
    // résoudre `null` ici fait lever `updateScene` (`data.hasOwnProperty` sur null) en
    // REJET NON TRAITÉ, parce que `loadScene()` n'a pas de `.catch`. C'est un défaut ouvert
    // du chemin `save_board = 1`, hors du périmètre de ce lot — reproduit en écrivant ce
    // fichier le 01/09/2026, consigné dans work/. Ne pas « corriger » le mock : c'est le
    // code de production qui doit se défendre.
    vi.spyOn(serverStore, 'loadWhiteBoard').mockResolvedValue({ elements: [], files: {} })
    vi.spyOn(serverStore, 'saveWhiteBoard').mockResolvedValue(null)

    return mount(WhiteboardComponent, {
        // `mounted()` cherche l'élément custom par `document.querySelector` : le composant
        // doit donc être DANS le document, pas dans un fragment détaché.
        attachTo: document.body,
        props: {
            users: [{ slug: ME.slug }, { slug: PEER }],
            room: { id: 'room-1', save_board: saveBoard },
            displayCollaborators: false,
        },
        global: {
            stubs: {
                ChatCreatorButton: { template: '<button />' },
                RoomUsersList: { props: ['users'], template: '<div />' },
                MediaBroadcastProvider: {
                    props: ['users', 'room', 'callbacks', 'mode', 'options'],
                    data() {
                        return { api: { sendData, sendDataOnConnection } }
                    },
                    template: '<div />',
                },
            },
        },
    })
}

/** Une connexion entrante : sa metadata est construite par le pair, donc `from` est le sien. */
const incomingConn = () => ({ open: true, metadata: { from: PEER, slug: ME.slug } })

/** Une connexion sortante : c'est MOI qui l'ai ouverte, donc `from` est mon slug. */
const outgoingConn = () => ({ open: true, metadata: { from: ME.slug, slug: PEER } })

describe('WhiteboardComponent — renvoi de la scène à un arrivant', () => {
    let wrapper

    beforeEach(() => {
        vi.useFakeTimers()
        sceneElements = [{ id: 'cercle-1', type: 'ellipse' }]
        sendData = vi.fn()
        sendDataOnConnection = vi.fn()
    })

    afterEach(() => {
        wrapper?.unmount()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    /**
     * ⭐ LE cas de régression, et il tient par ses DEUX assertions : le renvoi part sur la
     * connexion reçue, et il ne passe PAS par `sendData`. Écrit avec `sendData` — le code
     * d'avant — la seconde assertion rougit.
     */
    it('renvoie la scène SUR la connexion entrante reçue, jamais par une résolution par slug', () => {
        wrapper = mountWhiteboard()
        const conn = incomingConn()

        wrapper.vm.handleConnectionOpen(conn)
        vi.advanceTimersByTime(1000)

        expect(sendDataOnConnection).toHaveBeenCalledTimes(1)
        expect(sendData).not.toHaveBeenCalled()

        const [sentConn, payload] = sendDataOnConnection.mock.calls[0]
        expect(sentConn).toBe(conn)
        expect(payload.action).toBe('update_scene')
        expect(payload.details.elements).toEqual(sceneElements)
    })

    /**
     * L'`appState` porte une `Map` (`collaborators`) sur laquelle BinaryPack LÈVE, et le
     * récepteur ne l'a jamais lu — `ExcalidrawElement.updateScene` lit `data.state`, que
     * personne n'émet. La forme transportable est donc une liste blanche de deux clés.
     */
    it("n'émet que `elements` et `files`, jamais l'appState", () => {
        wrapper = mountWhiteboard()

        wrapper.vm.handleConnectionOpen(incomingConn())
        vi.advanceTimersByTime(1000)

        const payload = sendDataOnConnection.mock.calls[0][1]
        expect(Object.keys(payload.details).sort()).toEqual(['elements', 'files'])
        expect(payload.details).not.toHaveProperty('appState')
    })

    /**
     * `onConnectionOpen` tire dans les DEUX sens (`setUpConnectionListeners` est appelé par
     * `usePeerConnections` au sortant et par `usePeerTransport` à l'entrant), et en mesh
     * chaque paire a deux connexions : sans ce garde, chaque pair renverrait sa scène deux
     * fois par arrivant.
     */
    it('ne renvoie rien sur une connexion SORTANTE', () => {
        wrapper = mountWhiteboard()

        wrapper.vm.handleConnectionOpen(outgoingConn())
        vi.advanceTimersByTime(1000)

        expect(sendDataOnConnection).not.toHaveBeenCalled()
    })

    it('ne renvoie rien sur un tableau enregistrable (l\'arrivant charge du serveur)', () => {
        wrapper = mountWhiteboard({ saveBoard: 1 })

        wrapper.vm.handleConnectionOpen(incomingConn())
        vi.advanceTimersByTime(1000)

        expect(sendDataOnConnection).not.toHaveBeenCalled()
    })

    it('ne renvoie rien quand la scène est vide', () => {
        sceneElements = []
        wrapper = mountWhiteboard()

        wrapper.vm.handleConnectionOpen(incomingConn())
        vi.advanceTimersByTime(1000)

        expect(sendDataOnConnection).not.toHaveBeenCalled()
    })

    /**
     * Le délai d'une seconde n'est pas cosmétique : il protège le RÉCEPTEUR, qui vient de
     * monter et dont `updateScene` abandonne la scène si `excalidrawAPI` n'est pas prêt.
     * Ce cas épingle qu'il existe — sans lui, quelqu'un le retirerait en croyant nettoyer.
     */
    it("n'émet rien avant l'échéance du délai", () => {
        wrapper = mountWhiteboard()

        wrapper.vm.handleConnectionOpen(incomingConn())
        vi.advanceTimersByTime(999)

        expect(sendDataOnConnection).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)

        expect(sendDataOnConnection).toHaveBeenCalledTimes(1)
    })
})
