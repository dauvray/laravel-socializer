<template>
    <section class="feed-wrapper" v-if="loaded">
        <PublishButton
            v-if="feed && canPublish"
            :feedFormId="feed.questionnaire"
            :feedId="feed.id"
        ></PublishButton>
        <PostList
            :posts="posts"
            :pagination="true"
            @load-posts="onLoadFeedPost"
            @delete-post="onPostDelete"
            @like-item="onLikeItem"
            @share-item="onShareItem"
            @comment-created="onCommentCreated"
            @comment-deleted="onCommentDeleted"
        ></PostList>
    </section>
</template>

<script setup>
    // VUE & LIBS
    import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
    import { storeToRefs } from 'pinia'

    // STORES
    import { useFeedStore } from '~socializer/stores/feed.js'
    import { useLikesStore } from '~socializer/stores/likes.js'
    import { useMeStore } from '~estarter/stores/me.js'

    // COMPOSABLES
    import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

    // COMPOSANTS
    import PostList from './PostList.vue'

    // COMPOSANTS ASYNCHRONES
    const PublishButton = defineAsyncComponent(() => import('~socializer/components/User/widgets/PublishButton.vue'))

    defineOptions({ name: 'Feed' })

    const props = defineProps({
        user: {
            type: Object,
            required: true,
        },
        type: {
            type: String,
            required: false,
            default: 'feed', // or wall
        },
        owner: {
            type: String,
            required: false,
            default: undefined, // user by default ( can be room ...)
        },
        canPublish: {
            type: Boolean,
            required: false,
            default: false,
        },
    })

    const emit = defineEmits([
        'feed-loaded',
    ])

    /*------ STORES ----------*/
    const feedStore = useFeedStore()
    const { getPostFeed: posts } = storeToRefs(feedStore)
    const {
        loadFeed,
        loadFeedPost,
        resetFeed,
        deleteFeedPost,
        removePost,
        insertPost,
        triggerFeedActivity,
        updatePostLikes,
        sharePost,
        setSharedPost,
        manageFeedActivity,
    } = feedStore

    const { submitLike } = useLikesStore()
    const { getMe } = storeToRefs(useMeStore())

    /*------ STATE ----------*/
    const feedId = ref(null)
    const feed = ref(null)
    const loaded = ref(false)

    /*------ COMPUTED ----------*/
    const meChannelName = computed(() => getMe.value?.channel ?? null)
    const feedChannelName = computed(() => feedId.value ? `${feedId.value}.feed` : null)

    /*------ ECHO / REVERB ----------*/
    // S'exécute avant les leave() auto enregistrés par les useReverbChannel ci-dessous. Le `const`
    // lu par une closure déclarée au-dessus est volontaire : elle ne le lit qu'au démontage.
    onBeforeUnmount(() => {
        whisperMe('leave-feed', {
            feedId: feedId.value,
            userId: getMe.value.id,
        })
    })

    const { whisper: whisperMe } = useReverbChannel(meChannelName, {
        type: 'private',
    })

    // Nom réactif : le composable quitte l'ancien feed et rejoint le nouveau tout seul.
    useReverbChannel(feedChannelName, {
        type: 'public',
        listeners: {
            '.Dauvray\\Socializer\\app\\Events\\FeedActivity': (event) => manageFeedActivity(event),
            '.Dauvray\\Socializer\\app\\Events\\PostCreatedEvent': (event) => insertPost(event.post),
            '.Dauvray\\Socializer\\app\\Events\\PostDeletedEvent': (event) => removePost(event.post_id),
            '.Dauvray\\Socializer\\app\\Events\\ItemLiked': (event) => updatePostLikes(event.likes, event.vertexid, event.storeid),
        },
    })

    /*------ METHODS ----------*/
    function onLoadFeedPost(url) {
        loadFeedPost(url)
    }

    async function onPostDelete(postId) {
        await deleteFeedPost(postId, feedId.value)
        removePost(postId)
    }

    function onLikeItem(payload) {
        submitLike(payload, feedId.value, 'feed')
        .then((likes) => {
            updatePostLikes(likes, payload.itemVid, feedId.value)
        })
    }

    function onShareItem(postVid) {
        sharePost(postVid, feedId.value)
        .then(post => {
            setSharedPost(post)
        })
    }

    function onCommentCreated(comment) {
        triggerFeedActivity({
            feed_id: feedId.value,
            action: 'comment.created',
            element: comment,
        })
    }

    function onCommentDeleted(comment) {
        triggerFeedActivity({
            feed_id: feedId.value,
            action: 'comment.deleted',
            element: comment,
        })
    }

    /*------ WATCHERS ----------*/
    // SOUS les appels au composable : les watchers partent dans leur ordre de création, et on veut
    // le join du canal du feed avant le chargement HTTP des posts.
    watch(feedId, (newFeedId) => {
        loadFeedPost(`/get-feed-posts/${newFeedId}`)
    })

    /*------ LIFECYCLE ----------*/
    onMounted(() => {
        loadFeed(props.user.identifier, props.type, props.owner)
        .then(resp => {
            feedId.value = resp.id
            setTimeout(() => {
                loaded.value = true
            }, 100)
            feed.value = resp
            emit('feed-loaded', resp)
        })
    })

    // Le whisper `leave-feed` et le leave() des deux canaux sont enregistrés plus haut, en
    // onBeforeUnmount : le reset du store ne doit jamais les précéder.
    onUnmounted(() => {
        resetFeed()
    })
</script>
