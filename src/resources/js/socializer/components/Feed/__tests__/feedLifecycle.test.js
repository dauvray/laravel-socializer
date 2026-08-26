/**
 * feedLifecycle.test.js
 *
 * Périmètre : le CÂBLAGE de `Feed.vue`, pas le comportement du store `feed`. Ce que ces tests
 * épinglent, c'est ce que le composant appelle, dans quel ordre, et avec quels arguments — trois
 * choses qu'aucun type ni aucun lint ne protège ici, et que la migration du fichier en
 * `<script setup>` a toutes réécrites.
 *
 * Le test qui compte le plus est le dernier : **le whisper `leave-feed` doit partir AVANT les
 * `leave()` des canaux.** `useReverbChannel` enregistre son `onBeforeUnmount(leave)` au moment de
 * l'appel, et Vue exécute ces hooks dans leur ordre d'ENREGISTREMENT ; inverser deux lignes suffit
 * donc à perdre le whisper — sans exception, sans log, `whisper()` rendant `false` en silence. Côté
 * serveur, `UserOnlineWhisperListener` n'efface alors rien et l'utilisateur reste « dans » un feed
 * qu'il a quitté. Le détail :
 * docs/reference/use-reverb-channel.md#un-whisper-de-départ-senregistre-avant-le-composable
 *
 * ⚠️ **Les imports du composant et des stores sont DYNAMIQUES, et c'est obligatoire.**
 * `stores/feed/actions.js` appelle `useCommentStore()` au CHARGEMENT du module (ligne 6), donc il
 * exige une pinia active à l'import — que le `beforeEach` de `WebRTC2/__tests__/setup.js` ne pose
 * qu'après l'évaluation des imports statiques, lesquels sont hoistés. En production le problème
 * n'existe pas : les chunks de route sont chargés paresseusement, bien après `app.use(pinia)`.
 * Corollaire à connaître : le `commentStore` capturé au premier import reste lié à la pinia de ce
 * moment-là. Aucun test ici ne passe par les compteurs de commentaires imbriqués.
 *
 * Choix d'infrastructure : `Echo` est une global posée par le projet hôte — doublure partagée
 * (`System/composables/__tests__/helpers/createEchoDouble.js`), et non `vi.mock`. Les stores, eux,
 * sont les VRAIS : `storeToRefs` se comporte exactement comme en production, ce qu'aucun mock ne
 * garantit (les getters Pinia sont auto-déballés — piège documenté dans
 * docs/modules/webrtc2/tests.md#pièges-de-mock).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createEchoDouble } from '~socializer/components/System/composables/__tests__/helpers/createEchoDouble.js'

const ME = { id: 7, channel: 'App.Models.User.7' }

/** Charge utile de `/owner-wall/{identifier}/{owner}` : `id` porte le feed, `questionnaire` le formulaire de publication. */
const FEED = { id: 42, questionnaire: 3 }

const FEED_CHANNEL = '42.feed'
const LIKES = { likes: 4, dislikes: 1 }

/** Nom d'événement Laravel tel que Reverb le diffuse : classe pleinement qualifiée, préfixée d'un point. */
const EVENT = (name) => `.Dauvray\\Socializer\\app\\Events\\${name}`

/** Un item de feed tel que `PostCollection` le rend : le post est imbriqué sous la clé `post`. */
const postItem = (overrides = {}) => ({
    post: {
        id: 'p1',
        vertexid: 'v1',
        nb_comments: 0,
        likes: 0,
        dislikes: 0,
        ...overrides,
    },
})

let Feed
let PostList
let useFeedStore
let useLikesStore
let useMeStore

let channels
let trace
let wrappers

/**
 * Trace unique pour ordonner ce que quatre mécanismes distincts produisent : le join d'un canal,
 * le chargement HTTP des posts, le whisper de départ et la libération des canaux. C'est le seul
 * moyen d'exprimer « avant » et « après » en assertions.
 *
 * Les DEUX fabriques de canaux sont instrumentées : `me.channel` est privé (`Echo.private`) et
 * celui du feed est public (`Echo.channel`) — n'en tracer qu'une rendrait le test aveugle à la
 * moitié de l'ordre qu'il prétend vérifier.
 */
beforeEach(async () => {
    trace = []
    wrappers = []

    const double = createEchoDouble()
    channels = double.channels

    const tracedFactory = (factory) => vi.fn((name) => {
        trace.push(`join:${name}`)
        return factory(name)
    })

    globalThis.Echo = {
        ...double.Echo,
        channel: tracedFactory(double.Echo.channel),
        private: tracedFactory(double.Echo.private),
        leave: vi.fn((name) => {
            trace.push(`echo.leave:${name}`)
            return double.Echo.leave(name)
        }),
    }

    // Imports dynamiques obligatoires — voir l'en-tête du fichier.
    ;({ useFeedStore } = await import('~socializer/stores/feed.js'))
    ;({ useLikesStore } = await import('~socializer/stores/likes.js'))
    ;({ useMeStore } = await import('~estarter/stores/me.js'))
    ;({ default: Feed } = await import('~socializer/components/Feed/Feed.vue'))
    ;({ default: PostList } = await import('~socializer/components/Feed/PostList.vue'))
})

afterEach(() => {
    /**
     * `consumersByChannel`, dans `useReverbChannel.js`, est un état de MODULE que vitest ne
     * réinitialise pas d'un `it` à l'autre. Un composant laissé monté par un test en échec fait
     * donc croire au suivant qu'un autre consommateur tient encore le canal, et son `leave()`
     * n'appelle plus `Echo.leave()` — un échec en cascade qui masque sa vraie cause. D'où ce filet.
     */
    wrappers.forEach(wrapper => wrapper.unmount())
    delete globalThis.Echo
})

/**
 * Prépare les vrais stores : seule la couche réseau est doublée. Les actions purement d'état
 * (`removePost`, `insertPost`, `updatePostLikes`, `manageFeedActivity`) gardent leur vraie
 * implémentation — `vi.spyOn` sans `mockImplementation` appelle l'original — pour qu'un test qui
 * vérifie un appel n'ait pas à faire confiance à une doublure sur ce que l'appel produit.
 *
 * `posts` est semé : ces actions déréférencent `this.posts.data` sans garde.
 */
const seedStores = () => {
    const meStore = useMeStore()
    meStore.user = { ...ME }              // `getMe` rend `this.user`

    const feedStore = useFeedStore()
    const likesStore = useLikesStore()

    feedStore.posts = { data: [postItem()], total: 1 }

    vi.spyOn(feedStore, 'loadFeed').mockResolvedValue(FEED)
    vi.spyOn(feedStore, 'loadFeedPost').mockImplementation((url) => {
        trace.push(`load:${url}`)
        return Promise.resolve()
    })
    vi.spyOn(feedStore, 'resetFeed').mockImplementation(() => {
        trace.push('reset')
    })
    vi.spyOn(feedStore, 'deleteFeedPost').mockResolvedValue(true)
    vi.spyOn(feedStore, 'sharePost').mockResolvedValue(postItem({ id: 'p2' }))
    vi.spyOn(feedStore, 'triggerFeedActivity').mockResolvedValue(undefined)
    vi.spyOn(likesStore, 'submitLike').mockResolvedValue(LIKES)

    vi.spyOn(feedStore, 'removePost')
    vi.spyOn(feedStore, 'insertPost')
    vi.spyOn(feedStore, 'updatePostLikes')
    vi.spyOn(feedStore, 'setSharedPost')
    vi.spyOn(feedStore, 'manageFeedActivity')

    return { feedStore, likesStore, meStore }
}

/**
 * `shallow` : les enfants ne sont que stubés, ce qui évite de monter `Post.vue`,
 * `PaginationOrIntersection` et le `PublishButton` asynchrone pour tester le seul câblage du parent.
 */
const mountFeed = async (props = {}) => {
    const stores = seedStores()

    const wrapper = mount(Feed, {
        props: { user: { identifier: 'bob' }, ...props },
        shallow: true,
    })
    wrappers.push(wrapper)

    // Résout le `loadFeed()` du onMounted, puis laisse partir les watchers qu'il déclenche.
    await flushPromises()
    await nextTick()

    return { wrapper, ...stores }
}

/** Démonte tout de suite, et retire du filet d'`afterEach` pour ne pas démonter deux fois. */
const unmountNow = (wrapper) => {
    wrapper.unmount()
    wrappers = wrappers.filter(other => other !== wrapper)
}

/** `loaded` est posé par un `setTimeout(…, 100)` : rien n'est rendu avant. */
const awaitLoaded = async () => {
    await new Promise(resolve => setTimeout(resolve, 130))
    await nextTick()
}

/** Récupère le handler que `useReverbChannel` a posé sur le canal public du feed. */
const feedChannelListener = (event) => {
    const channel = channels.get(FEED_CHANNEL)
    const call = channel?.listen.mock.calls.find(([name]) => name === event)

    if (!call) {
        throw new Error(`aucun listener posé pour "${event}" sur ${FEED_CHANNEL}`)
    }
    return call[1]
}

/** Instrumente le whisper du canal privé pour l'ordonner avec les `Echo.leave()`. */
const traceWhispers = (channel) => {
    const original = channel.whisper

    channel.whisper = vi.fn(function (event, payload) {
        trace.push(`whisper:${event}`)
        return original.call(this, event, payload)
    })

    return channel.whisper
}

describe('Feed.vue — montage', () => {

    it('charge le feed du propriétaire demandé, puis annonce le résultat', async () => {
        // La forme de WallRoom/WallComponent.vue : le feed d'une room, pas celui d'un utilisateur.
        const { wrapper, feedStore } = await mountFeed({
            user: { identifier: 'room-9' },
            type: 'wall',
            owner: 'room',
        })

        expect(feedStore.loadFeed).toHaveBeenCalledWith('room-9', 'wall', 'room')

        // `feed-loaded` est la SEULE voie par laquelle Wall.vue et WallComponent.vue obtiennent
        // l'id du feed et celui de son formulaire : sans lui, leur PublishButton téléporté reste
        // sur `feedId: null` et ne publie rien. L'émission avait été commentée.
        expect(wrapper.emitted('feed-loaded')).toEqual([[FEED]])
    })

    it('ne rend la section qu\'une fois le feed chargé', async () => {
        const { wrapper } = await mountFeed()

        expect(wrapper.find('section.feed-wrapper').exists()).toBe(false)

        await awaitLoaded()

        expect(wrapper.find('section.feed-wrapper').exists()).toBe(true)
    })

    it('rejoint le canal du feed AVANT de charger ses posts', async () => {
        await mountFeed()

        // Les deux partent de watchers créés dans le même setup(), et les watchers s'exécutent dans
        // leur ordre de CRÉATION : remonter le `watch(feedId)` au-dessus des appels à
        // useReverbChannel ouvrirait une fenêtre où un PostCreatedEvent arrive entre le chargement
        // HTTP et la souscription — un post perdu jusqu'au rechargement de la page.
        expect(trace).toEqual([
            `join:${ME.channel}`,          // canal privé personnel, nom connu dès le montage
            `join:${FEED_CHANNEL}`,
            `load:/get-feed-posts/${FEED.id}`,
        ])
    })

    it('transmet les posts du store à PostList', async () => {
        const { wrapper, feedStore } = await mountFeed()
        await awaitLoaded()

        // Épingle la traduction de `mapState(useFeedStore, { posts: 'getPostFeed' })` en
        // `storeToRefs` : le getter rend `posts.data`, jamais l'objet paginé complet.
        expect(wrapper.findComponent(PostList).props('posts')).toEqual(feedStore.posts.data)
    })
})

/**
 * Ces quatre tests gardent la déstructuration des actions du store faite au montage : une action
 * absente de la liste vaut `undefined`, et le listener lèverait au premier événement reçu — c'est-
 * à-dire en production, jamais au build.
 */
describe('Feed.vue — les événements Reverb routent vers les actions du store', () => {

    it('FeedActivity → manageFeedActivity', async () => {
        const { feedStore } = await mountFeed()

        // `store: ''` = commentaire de POST (et non sous-commentaire). ⚠️ La chaîne vide est
        // significative : `commentCreatedTrigger` teste `isEmpty(element.store)`, or `isEmpty`
        // fait `Object.keys(obj)` sans garde — un `null` y lèverait.
        const activity = { activity: { action: 'comment.created', element: { parent: 'v1', store: '' } } }

        feedChannelListener(EVENT('FeedActivity'))(activity)

        expect(feedStore.manageFeedActivity).toHaveBeenCalledWith(activity)
        // Effet réel : le compteur de commentaires du post visé est incrémenté.
        expect(feedStore.posts.data[0].post.nb_comments).toBe(1)
    })

    it('PostCreatedEvent → insertPost, en tête de liste', async () => {
        const { feedStore } = await mountFeed()
        const created = postItem({ id: 'p9', vertexid: 'v9' })

        feedChannelListener(EVENT('PostCreatedEvent'))({ post: created })

        expect(feedStore.insertPost).toHaveBeenCalledWith(created)
        expect(feedStore.posts.data[0].post.id).toBe('p9')
        expect(feedStore.posts.total).toBe(2)
    })

    it('PostDeletedEvent → removePost, sur post_id et non sur le vertexid', async () => {
        const { feedStore } = await mountFeed()

        feedChannelListener(EVENT('PostDeletedEvent'))({ post_id: 'p1' })

        expect(feedStore.removePost).toHaveBeenCalledWith('p1')
        expect(feedStore.posts.data).toEqual([])
    })

    it('ItemLiked → updatePostLikes(likes, vertexid, storeid), dans cet ordre', async () => {
        const { feedStore } = await mountFeed()

        // Trois arguments positionnels de même nature : un ordre inversé passerait le build, les
        // tests de type et la revue.
        feedChannelListener(EVENT('ItemLiked'))({
            likes: LIKES,
            vertexid: 'v1',
            storeid: FEED.id,
        })

        expect(feedStore.updatePostLikes).toHaveBeenCalledWith(LIKES, 'v1', FEED.id)
        expect(feedStore.posts.data[0].post.likes).toBe(LIKES.likes)
        expect(feedStore.posts.data[0].post.dislikes).toBe(LIKES.dislikes)
    })
})

/**
 * `feedId` était lu par `this.feedId` depuis les options, alors qu'il vivait déjà dans le `setup()`.
 * Ces tests gardent le fait que chaque action déclenchée depuis la liste le porte toujours.
 */
describe('Feed.vue — les actions de la liste portent l\'id du feed courant', () => {

    const mountList = async () => {
        const mounted = await mountFeed()
        await awaitLoaded()
        return { ...mounted, list: mounted.wrapper.findComponent(PostList) }
    }

    it('delete-post supprime côté serveur puis côté store', async () => {
        const { list, feedStore } = await mountList()

        list.vm.$emit('delete-post', 'p1')
        await flushPromises()

        expect(feedStore.deleteFeedPost).toHaveBeenCalledWith('p1', FEED.id)
        expect(feedStore.removePost).toHaveBeenCalledWith('p1')
    })

    it('like-item soumet le like puis reporte le décompte rendu par le serveur', async () => {
        const { list, feedStore, likesStore } = await mountList()

        list.vm.$emit('like-item', { itemVid: 'v1' })
        await flushPromises()

        expect(likesStore.submitLike).toHaveBeenCalledWith({ itemVid: 'v1' }, FEED.id, 'feed')
        expect(feedStore.updatePostLikes).toHaveBeenCalledWith(LIKES, 'v1', FEED.id)
    })

    it('share-item remplace le post partagé par ce que rend le serveur', async () => {
        const { list, feedStore } = await mountList()

        list.vm.$emit('share-item', 'v1')
        await flushPromises()

        expect(feedStore.sharePost).toHaveBeenCalledWith('v1', FEED.id)
        expect(feedStore.setSharedPost).toHaveBeenCalled()
    })

    it('comment-created et comment-deleted déclenchent l\'activité du feed', async () => {
        const { list, feedStore } = await mountList()
        const comment = { id: 'c1', parent: 'v1' }

        list.vm.$emit('comment-created', comment)
        list.vm.$emit('comment-deleted', comment)

        expect(feedStore.triggerFeedActivity).toHaveBeenNthCalledWith(1, {
            feed_id: FEED.id,
            action: 'comment.created',
            element: comment,
        })
        expect(feedStore.triggerFeedActivity).toHaveBeenNthCalledWith(2, {
            feed_id: FEED.id,
            action: 'comment.deleted',
            element: comment,
        })
    })
})

/**
 * LE test de l'invariant. Il porte sur un ordre de LIGNES dans le `setup()` : le hook qui whispere
 * doit être enregistré avant l'appel à `useReverbChannel`, et le reset du store après.
 */
describe('Feed.vue — ordre de démontage', () => {

    it('whispere leave-feed AVANT de libérer les canaux, et ne reset le store qu\'ensuite', async () => {
        const { wrapper } = await mountFeed()
        const whisper = traceWhispers(channels.get(`private-${ME.channel}`))

        trace.length = 0
        unmountNow(wrapper)

        expect(trace).toEqual([
            'whisper:leave-feed',
            `echo.leave:${ME.channel}`,
            `echo.leave:${FEED_CHANNEL}`,
            'reset',
        ])

        // Le whisper part sur le canal privé PERSONNEL, avec l'identité de qui part et le feed
        // quitté : c'est ce couple que `UserOnlineWhisperListener` transforme en `removeUserItem`.
        expect(whisper).toHaveBeenCalledWith('leave-feed', {
            feedId: FEED.id,
            userId: ME.id,
        })
    })
})
