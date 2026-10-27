/**
 * ApplicationComponent.load.test.js
 *
 * Périmètre : QUAND `ApplicationComponent` demande son application au serveur, et rien d'autre —
 * ni ce qui est écrit dans l'iframe, ni le protocole postMessage. La couche réseau est doublée
 * (`loadApplication`), les stores sont les vrais.
 *
 * Le bug épinglé (27/10/2026) : à la PREMIÈRE entrée dans un salon Application depuis un serveur
 * déjà ouvert, le spinner ne partait jamais ; ressortir puis revenir, ou recharger la page,
 * affichait l'app. Cause : `loadComponent()` n'était appelé que par le `watch` de la prop `users`,
 * donc seulement si la liste de présence CHANGEAIT après le montage. Or `Room.vue` rejoint
 * `room.{id}` PUIS pousse la route du contenu : pusher confirme la présence (`here`) par un
 * aller-retour pendant que le routeur charge ce module. Au premier import, le chunk perd la
 * course, le composant monte avec `users` déjà pleine, le watcher ne tire jamais, et rien ne
 * demande l'app. Au second passage le module est en cache, le composant monte avant `here`, et le
 * watcher suffit. Rien en console dans le cas perdant : il ne s'y exécute rien.
 *
 * L'app rendue par la doublure n'a pas de `code` : `loadComponent()` n'écrit alors rien dans
 * l'iframe — happy-dom ne donne pas de document à une iframe détachée, et ce n'est pas le fait
 * testé.
 *
 * **Contrôle de harnais effectué** (règle 4 de `docs/architecture/tests.md`), trois mutations
 * de `ApplicationComponent.vue`, une par mécanisme. Chacune rougit exactement UN cas, et jamais
 * le même — mesuré, pas prédit : la première annonçait deux rouges, le garde absorbe le second.
 *
 * - retirer la demande faite dans `mounted()` → « présence déjà connue » : 0 appel ;
 * - retirer le garde `applicationRequested` → « une seule fois » : 2 appels ;
 * - demander l'app dans `mounted()` SANS condition sur la présence → « attend la présence » :
 *   un appel avant tout `here`. C'est la mutation qui rend l'assertion négative discriminante —
 *   règle 5.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useApplicationAIStore } from '~socializer/stores/applicationAI.js'
import { useMeStore } from '~estarter/stores/me.js'
import ApplicationComponent from '~socializer/components/Application/ApplicationComponent.vue'

const ME = { id: 7, slug: 'me', name: 'Moi', image: null, function: null }
const OTHER = { id: 8, slug: 'other', name: 'Autre', image: null, function: null }
const ROOM = { id: 'r1', name: 'Application', content: [{ id: 'v1', content_type: 'application' }] }

/** Ce que `/load-ia-application` rend pour un salon sans app enregistrée : rien à écrire. */
const EMPTY_APPLICATION = { data: null, code: null, infos: null }

let wrappers = []

afterEach(() => {
    wrappers.forEach(wrapper => wrapper.unmount())
    wrappers = []
})

/** Vrais stores, seule la couche réseau est doublée. `getMe` rend `this.user`. */
const seedStores = () => {
    useMeStore().user = { ...ME }

    const applicationStore = useApplicationAIStore()
    vi.spyOn(applicationStore, 'loadApplication').mockResolvedValue(EMPTY_APPLICATION)

    return applicationStore
}

/**
 * `MediaBroadcastProvider` est stubé : il monterait tout le canal data WebRTC2 pour un test qui
 * ne regarde que l'appel réseau. `ApplicationModale` ne monte pas (`editable: false`).
 */
const mountApplication = async (props = {}) => {
    const applicationStore = seedStores()

    const wrapper = mount(ApplicationComponent, {
        props: { users: [], room: ROOM, editable: false, ...props },
        global: { stubs: { MediaBroadcastProvider: true, Sprinner2: true } },
    })
    wrappers.push(wrapper)

    // Laisse passer le `await nextTick()` du mounted(), puis la demande qu'il déclenche.
    await flushPromises()
    await nextTick()
    await flushPromises()

    return { wrapper, applicationStore }
}

describe('ApplicationComponent — quand l\'application est demandée', () => {
    it('la demande au montage quand la présence du salon est déjà connue', async () => {
        const { applicationStore } = await mountApplication({ users: [ME, OTHER] })

        expect(applicationStore.loadApplication).toHaveBeenCalledTimes(1)
        expect(applicationStore.loadApplication).toHaveBeenCalledWith({ room_id: ROOM.id })
    })

    it('attend la présence quand elle n\'est pas encore connue, puis la demande', async () => {
        const { wrapper, applicationStore } = await mountApplication({ users: [] })

        expect(applicationStore.loadApplication).not.toHaveBeenCalled()

        await wrapper.setProps({ users: [ME] })
        await flushPromises()

        expect(applicationStore.loadApplication).toHaveBeenCalledTimes(1)
        expect(applicationStore.loadApplication).toHaveBeenCalledWith({ room_id: ROOM.id })
    })

    it('ne la demande qu\'une seule fois quand la présence change avant que l\'iframe ne se signale', async () => {
        const { wrapper, applicationStore } = await mountApplication({ users: [ME] })

        await wrapper.setProps({ users: [ME, OTHER] })
        await flushPromises()
        await wrapper.setProps({ users: [ME] })
        await flushPromises()

        expect(applicationStore.loadApplication).toHaveBeenCalledTimes(1)
    })
})
