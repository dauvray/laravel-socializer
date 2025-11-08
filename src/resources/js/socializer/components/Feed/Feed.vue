<template>
    <div>
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
    </div>
</template>

<script>

    import { mapActions, mapState } from 'pinia'
    import { useFeedStore } from '~socializer/stores/feed.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import PostList from './PostList.vue'
    import { useLikesStore } from '~socializer/stores/likes.js'

    export default {
        name: 'Feed',
        emits: [
            'feed-loaded',
        ],
        components: {
            PostList,
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
                default: undefined
            },
        },
        data() {
            return {
                feedId: null,
            }
        },
        mounted() {
            this.loadFeed(this.user.identifier, this.type, this.owner)
            .then(resp => {
                this.feedId = resp.id
                this.$emit('feed-loaded', resp)
            })
        },
        beforeUnmount() {
            this.resetFeed()
            Echo.private(this.me.channel).whisper('leave-feed', {
                feedId: this.feedId,
                userId: this.me.id,
            });
            Echo.leave(this.channel) 
        },
        watch: {
            feedId(newFeedId, oldFeedId) {
                if(newFeedId !== oldFeedId) {
                    this.iniFeedEvents()
                    this.loadFeedPost(`/get-feed-posts/${newFeedId}`)
                }
            },
        },
        computed: {
            ...mapState(useFeedStore, {
                posts: 'getPostFeed',
            }),
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            channel: function() {
                if(this.feedId) {
                    return `${this.feedId}.feed`
                }
                return null
            },
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
                'manageFeedActivity',
                'insertPost',
            ]),
            ...mapActions(useLikesStore, [
                'submitLike',
            ]),
            iniFeedEvents() {
                Echo.leave(this.channel)
                Echo.channel(this.channel)
                    // Feed activity
                    .listen('.Dauvray\\Socializer\\app\\Events\\FeedActivity', (event) => {
                    this.manageFeedActivity(event)
                    })
                    // Submit post
                    .listen('.Dauvray\\Socializer\\app\\Events\\PostCreatedEvent', (event) => {
                        this.insertPost(event.post)
                    })
                    // Delete post
                    .listen('.Dauvray\\Socializer\\app\\Events\\PostDeletedEvent', (event) => {
                        this.removePost(event.post_id)
                    })
                    // likes / dislikes
                    .listen('.Dauvray\\Socializer\\app\\Events\\ItemLiked', (event) => {
                        this.updatePostLikes(event.likes, event.vertexid, event.storeid)
                    })
            },
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