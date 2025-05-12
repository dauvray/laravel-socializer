<template>
    <PostList
        :posts="posts"
        :pagination="true"
         @delete-post="onPostDelete"
         @like-item="onLikeItem"
         @share-item="onShareItem"
         @comment-created="onCommentCreated"
         @comment-deleted="onCommentDeleted"
    ></PostList>
</template>

<script>

    import { mapActions, mapState } from 'pinia'
    import { useFeedStore } from '~socializer/stores/feed.js'
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
            }
        },
        data() {
            return {
                feedId: null,
            }
        },
        mounted() {
            this.loadFeed(this.user.identifier, this.type).then(resp => {
                this.feedId = resp.id
                this.$emit('feed-loaded', resp)
                this.loadFeedPost(this.feedId)
            })
        },
        beforeUnmount() {
            this.resetFeed()
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