/**
 * roomNavigation.test.js
 *
 * Périmètre : la **garde de navigation** de `Room.vue`, et rien d'autre. Ce qu'elle décide n'est
 * observable qu'à travers le routeur réel — d'où un test d'intégration avec l'arbre de routes du
 * paquet, et non un montage isolé du composant.
 *
 * Le bug épinglé (26/08/2026) : la garde appelait `router.push()` pour ouvrir le contenu par
 * défaut du salon. Deux conséquences, silencieuses toutes les deux :
 *
 * 1. **`push()` depuis une garde ANNULE la navigation en vol.** `pushWithRedirect()` écrit
 *    `pendingLocation` avant même son test de doublon, donc le `checkCanceledNavigation` de la
 *    navigation d'origine la solde en `NAVIGATION_CANCELLED` — que `RouterLink` avale
 *    (`.catch(noop)`). Aucune erreur en console : le clic ne faisait simplement RIEN.
 * 2. **La garde ne comparait pas `roomId`.** Elle redirigeait donc vers le contenu par défaut de
 *    `currentRoom`, qui porte encore l'ANCIEN salon tant que la navigation n'est pas confirmée :
 *    on ne pouvait plus changer de salon sans repasser par l'accueil du serveur.
 *
 * Le fil d'Ariane venait du même endroit : la garde y écrivait le nom du salon AVANT la
 * confirmation, et le watcher `$route` de l'`App.vue` du projet hôte reconstruit tout le tableau
 * depuis `route.meta.breadcrumb` APRÈS. D'où le symptôme qui a mis le doigt sur le bug — « il faut
 * cliquer deux fois pour voir le salon dans le fil d'Ariane » : le second clic n'était que la
 * navigation annulée du point 1, donc plus rien ne venait écraser l'écriture de la garde.
 *
 * **Contrôle de harnais effectué** (règle 4), garde d'avant remise en place — 4 des 6 `it`
 * rougissent, et leurs messages nomment le mécanisme :
 *
 * - « change de salon en UN clic » → `Navigation cancelled from "/app/server/srv1/room/room1/…"` ;
 * - les trois `it` de fil d'Ariane → `content` à `name: null`, et surtout `name: 'Chat'` là où
 *   « Feed » est attendu : la garde y écrivait le nom du salon qu'on QUITTE.
 *
 * Les deux `it` restés verts ne sont pas des discriminants du bug et ne prétendent pas l'être :
 * « ouvre le contenu par défaut … URL nue » couvre le chemin de MONTAGE, qui n'a jamais été cassé
 * (c'est par lui qu'on entrait dans un salon depuis l'accueil du serveur), et « rouvre le contenu
 * par défaut … salon déjà ouvert » aboutissait à la bonne URL même avant — par annulation puis
 * `push`, donc au prix de la navigation d'origine. Ce sont des filets de non-régression du
 * comportement conservé, pas la preuve du correctif.
 *
 * ⚠️ **Deux fidélités de harnais portent ce fichier, et les casser rendrait les tests verts à
 * tort :**
 *
 * - `ServerHost` reproduit le `<router-view :key="$route.params.roomId">` de `Server.vue`. C'est
 *   cette clé qui REMONTE `Room.vue` à chaque changement de salon, et donc ce qui autorise la
 *   garde à laisser passer un salon différent sans rien charger elle-même. Sans la clé, le
 *   correctif serait faux — et le test aveugle.
 * - `AppRoot` reproduit le watcher `$route` de l'`App.vue` du projet hôte. Sans lui, personne ne
 *   remet le fil d'Ariane à ses valeurs de `route.meta` et le test ne verrait jamais l'écrasement
 *   qui vidait l'entrée `content`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, watch } from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute } from 'vue-router'
import { createEchoDouble } from '~socializer/components/System/composables/__tests__/helpers/createEchoDouble.js'

/**
 * `routes/application.js` lit cette global au CHARGEMENT du module. Les imports statiques étant
 * hoistés, le fichier de routes est importé dynamiquement dans le `beforeEach` — c'est aussi ce que
 * fait la production, où les routes sont évaluées bien après `estarter-javascript.js`.
 */
globalThis.router_base_url = 'app'

const ME = { id: 7, channel: 'App.Models.User.7', vertexid: 'v-me' }
const SERVER_ID = 'srv1'

/**
 * Deux salons, tels que `/load-room/{id}` les rend. `room1` porte DEUX contenus : le second permet
 * de prouver que la garde redirige vers le contenu par **défaut** (`content[0]`) et pas vers celui
 * où l'on se trouve.
 */
const ROOMS = {
    room1: {
        id: 'room1',
        name: 'Chat',
        content: [
            { id: 'c-chat', content_type: 'chat', position: 1 },
            { id: 'c-wall', content_type: 'wall', position: 2 },
        ],
    },
    room2: {
        id: 'room2',
        name: 'Feed',
        content: [
            { id: 'f-wall', content_type: 'wall', position: 1 },
        ],
    },
}

let Room
let useServerStore
let useMeStore
let useApplicationStore
let useBreadcrumbService
let SocializerRoutes

let router
let wrappers

/** Un contenu de salon : ne rend rien d'utile, sert de feuille à l'arbre de routes. */
const ContentStub = defineComponent({
    name: 'ContentStub',
    inheritAttrs: false,
    setup() {
        const route = useRoute()
        return () => h('div', { class: 'room-content' }, String(route.name))
    },
})

/** Mirror de `Server.vue` : la clé sur `roomId` remonte `Room.vue` à chaque changement de salon. */
const ServerHost = defineComponent({
    name: 'ServerHost',
    setup() {
        const route = useRoute()
        return () => h(RouterView, { key: route.params.roomId })
    },
})

/**
 * Mirror de l'`App.vue` du projet hôte : à chaque navigation confirmée, il RECONSTRUIT le fil
 * d'Ariane depuis `route.meta.breadcrumb`. Enregistré ici, à la racine, il s'exécute donc avant les
 * watchers des descendants — exactement l'ordre de production, qui est tout l'enjeu.
 */
const AppRoot = defineComponent({
    name: 'AppRoot',
    setup() {
        const route = useRoute()
        const breadcrumbService = useBreadcrumbService()

        watch(route, () => {
            breadcrumbService.setBreadcrumb(route.meta.breadcrumb || [])
        })

        return () => h(RouterView)
    },
})

/**
 * L'arbre RÉEL du paquet, dont seuls les composants sont remplacés : c'est la hiérarchie des
 * `matched` records qui décide de ce qui est « updating » plutôt que « leaving », donc de si la
 * garde de `Room.vue` s'exécute. La reconstruire à la main serait tester une fiction.
 *
 * Les objets sont recréés par spread : le tableau importé est mémoïsé par le cache de modules et le
 * muter fuiterait d'un test à l'autre.
 */
const buildRoutes = () => {
    const server = SocializerRoutes.find(route => route.name === 'server')
    const room = server.children.find(route => route.name === 'room')

    return [{
        ...server,
        component: ServerHost,
        children: [{
            ...room,
            component: Room,
            children: room.children.map(child => ({ ...child, component: ContentStub })),
        }],
    }]
}

/** Le salon est servi par le réseau : seule cette couche est doublée, le reste du store est réel. */
const seedStores = () => {
    useMeStore().user = { ...ME }

    const serverStore = useServerStore()

    vi.spyOn(serverStore, 'loadRoom').mockImplementation(async (roomId) => {
        const room = ROOMS[roomId]

        if (!room) {
            return false
        }

        serverStore.currentRoom = structuredClone(room)
        return serverStore.currentRoom
    })

    return { serverStore }
}

/**
 * Laisse retomber la cascade complète : `initRoom()` attend le réseau, puis pousse vers le contenu
 * par défaut, ce qui déclenche une seconde navigation et les watchers qui la suivent.
 */
const settle = async () => {
    for (let pass = 0; pass < 4; pass++) {
        await flushPromises()
        await nextTick()
    }
}

const mountApp = async (initialLocation) => {
    const stores = seedStores()

    router = createRouter({ history: createMemoryHistory(), routes: buildRoutes() })
    router.push(initialLocation)
    await router.isReady()

    const wrapper = mount(AppRoot, { global: { plugins: [router] } })
    wrappers.push(wrapper)

    await settle()

    return { wrapper, ...stores }
}

const currentPath = () => router.currentRoute.value.fullPath

/** L'entrée que `Room.vue` a la charge de renseigner dans le fil d'Ariane. */
const breadcrumbContent = () =>
    useApplicationStore().getBreadcrumbs.find(item => item.id === 'content')

beforeEach(async () => {
    wrappers = []

    globalThis.Echo = createEchoDouble().Echo

    // Imports dynamiques : `router_base_url` doit être posée avant l'évaluation des routes.
    ;({ useServerStore } = await import('~socializer/stores/server.js'))
    ;({ useMeStore } = await import('~estarter/stores/me.js'))
    ;({ useApplicationStore } = await import('~estarter/stores/application.js'))
    ;({ useBreadcrumbService } = await import('~estarter/services/BreadcrumbService.js'))
    ;({ default: SocializerRoutes } = await import('~socializer/routes/application.js'))
    ;({ default: Room } = await import('~socializer/components/Server/Room.vue'))
})

afterEach(() => {
    /**
     * `consumersByChannel` est un état de MODULE dans `useReverbChannel.js` : un composant laissé
     * monté fait croire au test suivant qu'un consommateur tient encore le canal.
     */
    wrappers.forEach(wrapper => wrapper.unmount())
    delete globalThis.Echo
    vi.restoreAllMocks()
})

describe('Room.vue — garde de navigation', () => {
    it('ouvre le contenu par défaut du salon en arrivant sur une URL de salon nue', async () => {
        await mountApp({ name: 'room', params: { serverId: SERVER_ID, roomId: 'room1' } })

        expect(currentPath()).toBe(`/app/server/${SERVER_ID}/room/room1/chat/c-chat`)
    })

    it('change de salon en UN clic, sans annuler la navigation', async () => {
        await mountApp({ name: 'room', params: { serverId: SERVER_ID, roomId: 'room1' } })

        /**
         * C'est l'assertion centrale. Avec l'ancienne garde, ce `push` rendait un
         * `NavigationFailure` de type `cancelled` — donc un objet, et pas `undefined` — et l'URL ne
         * bougeait pas d'un pouce.
         */
        const failure = await router.push({
            name: 'room',
            params: { serverId: SERVER_ID, roomId: 'room2' },
        })
        await settle()

        expect(failure).toBeUndefined()
        expect(currentPath()).toBe(`/app/server/${SERVER_ID}/room/room2/wall/f-wall`)
    })

    it('rouvre le contenu par défaut quand on reclique le salon déjà ouvert', async () => {
        await mountApp({ name: 'room', params: { serverId: SERVER_ID, roomId: 'room1' } })

        await router.push({ name: 'wall', params: { serverId: SERVER_ID, roomId: 'room1', vertexId: 'c-wall' } })
        await settle()
        expect(currentPath()).toBe(`/app/server/${SERVER_ID}/room/room1/wall/c-wall`)

        // Retour sur l'URL nue du même salon : la garde REDIRIGE vers `content[0]`.
        await router.push({ name: 'room', params: { serverId: SERVER_ID, roomId: 'room1' } })
        await settle()

        expect(currentPath()).toBe(`/app/server/${SERVER_ID}/room/room1/chat/c-chat`)
    })
})

describe('Room.vue — fil d\'Ariane', () => {
    it('porte le nom du salon dès la première navigation', async () => {
        await mountApp({ name: 'room', params: { serverId: SERVER_ID, roomId: 'room1' } })

        expect(breadcrumbContent()).toMatchObject({ id: 'content', name: 'Chat' })
    })

    it('suit le salon quand on en change', async () => {
        await mountApp({ name: 'room', params: { serverId: SERVER_ID, roomId: 'room1' } })

        await router.push({ name: 'room', params: { serverId: SERVER_ID, roomId: 'room2' } })
        await settle()

        expect(breadcrumbContent()).toMatchObject({ id: 'content', name: 'Feed' })
    })

    it('survit à un changement de contenu dans le même salon', async () => {
        await mountApp({ name: 'room', params: { serverId: SERVER_ID, roomId: 'room1' } })

        await router.push({ name: 'wall', params: { serverId: SERVER_ID, roomId: 'room1', vertexId: 'c-wall' } })
        await settle()

        expect(breadcrumbContent()).toMatchObject({ id: 'content', name: 'Chat' })
    })
})
