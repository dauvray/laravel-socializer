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

<script>

    import { mapActions, mapState, storeToRefs } from 'pinia'
    import { useFeedStore } from '~socializer/stores/feed.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import PostList from './PostList.vue'
    import { useLikesStore } from '~socializer/stores/likes.js'
    import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'
    import { computed, defineAsyncComponent, onBeforeUnmount, ref } from 'vue'

    export default {
        name: 'Feed',
        emits: [
            'feed-loaded',
        ],
        components: {
            PostList,
            PublishButton: defineAsyncComponent(() => import('~socializer/components/User/widgets/PublishButton.vue')),
        },
        props: {
            user: {
                type: Object,
                required: true
            },
            type : {
               type: String,
               required: false,
               default: 'feed' // or wall 
            },
            owner: {
                type: String,
                required: false,
                default: undefined // user by default ( can be room ...)
            },
            canPublish: {
                type: Boolean,
                required: false,
                default: false,
            },
        },
        /**
         * Tout le câblage Reverb vit ici, et pas dans les options : Vue exécute les hooks de
         * démontage dans leur ordre d'ENREGISTREMENT, et `applyOptions()` tourne APRÈS `setup()`.
         * Un whisper laissé dans `beforeUnmount()` partirait donc après le `leave()` auto du
         * composable — c'est-à-dire jamais.
         */
        setup() {
            const feedStore = useFeedStore()
            const { getMe } = storeToRefs(useMeStore())

            // Remonté de data() : le hook de démontage ci-dessous en a besoin, et setup() ne voit
            // pas `data`. Retourné en fin de setup() → le reste des options le lit via `this.feedId`.
            const feedId = ref(null)

            const meChannelName = computed(() => getMe.value?.channel ?? null)
            const feedChannelName = computed(() => feedId.value ? `${feedId.value}.feed` : null)

            // S'exécute avant les leave() auto enregistrés par les useReverbChannel ci-dessous.
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
                    '.Dauvray\\Socializer\\app\\Events\\FeedActivity': (event) => feedStore.manageFeedActivity(event),
                    '.Dauvray\\Socializer\\app\\Events\\PostCreatedEvent': (event) => feedStore.insertPost(event.post),
                    '.Dauvray\\Socializer\\app\\Events\\PostDeletedEvent': (event) => feedStore.removePost(event.post_id),
                    '.Dauvray\\Socializer\\app\\Events\\ItemLiked': (event) => feedStore.updatePostLikes(event.likes, event.vertexid, event.storeid),
                },
            })

            return { feedId }
        },
        data() {
            return {
                feed: null,
                loaded: false,
            }
        },
        mounted() {
            this.loadFeed(this.user.identifier, this.type, this.owner)
            .then(resp => {
                this.feedId = resp.id
                setTimeout(() => {
                    this.loaded = true
                }, 100)
                this.feed = resp
               // this.$emit('feed-loaded', resp)
            })
        },
        beforeUnmount() {
            // Le whisper `leave-feed` et le leave() des deux canaux sont dans setup().
            this.resetFeed()
        },
        watch: {
            feedId(newFeedId, oldFeedId) {
                if(newFeedId !== oldFeedId) {
                    this.loadFeedPost(`/get-feed-posts/${newFeedId}`)
                }
            },
        },
        computed: {
            ...mapState(useFeedStore, {
                posts: 'getPostFeed',
            }),
        },
        methods: {
            ...mapActions(useFeedStore, [
                'loadFeed',
                'loadFeedPost',
                'resetFeed',
                'deleteFeedPost',
                'removePost',
                'triggerFeedActivity',
                'updatePostLikes',
                'sharePost',
                'setSharedPost',
            ]),
            ...mapActions(useLikesStore, [
                'submitLike',
            ]),
            onLoadFeedPost(url) {
                this.loadFeedPost(url)
            },
            async onPostDelete(postId) {
                const result = await this.deleteFeedPost(postId, this.feedId)
                this.removePost(postId)
            },
            onLikeItem(payload) {
                this.submitLike(payload, this.feedId, 'feed')
                .then((likes) => {
                    this.updatePostLikes(likes, payload.itemVid, this.feedId)
                })
            },
            onShareItem(postVid) {
                this.sharePost(postVid, this.feedId)
                .then( post => {
                    this.setSharedPost(post)
                })
            },
            onCommentCreated(comment) {
                this.triggerFeedActivity({
                    feed_id : this.feedId,
                    action : 'comment.created',
                    element: comment,
                })
            },
            onCommentDeleted(comment) {
                this.triggerFeedActivity({
                    feed_id : this.feedId,
                    action : 'comment.deleted',
                    element: comment,
                })
            },
        }
    }
</script>