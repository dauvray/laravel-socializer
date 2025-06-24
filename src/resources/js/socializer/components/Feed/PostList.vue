<template>
    <PostWidget
        v-for="item in posts"
        :key="item.post.id"
        :item="item"
        @delete-post="onPostDelete"
        @like-item="onLikeItem"
        @share-item="onShareItem"
        @comment-created="onCommentCreated"
        @comment-deleted="onCommentDeleted"
    ></PostWidget>
    <PaginationOrIntersection
        :paginator="paginator"
        :pagination="pagination"
        @load-page="onLoadPagination"
        @trigger-intersected="onTriggerObserver">
    </PaginationOrIntersection>
</template>

<script>

    import { defineAsyncComponent } from 'vue'
    import { mapState } from 'pinia'
    import { useFeedStore } from '~socializer/stores/feed.js'

    export default {
        name: 'PostList',
        emits: [
            'load-posts',
            'delete-post',
            'comment-created',
            'comment-deleted',
            'like-item',
            'share-item',
        ],
        components: {
            PostWidget: defineAsyncComponent(() => import('./Post.vue')),
            PaginationOrIntersection: defineAsyncComponent(() => import('~socializer/components/widgets/PaginationOrIntersection.vue')),
        },
        props: {
            posts: {
                type: Array,
                required: false,
                default: []
            },
            pagination: {
                type: Boolean,
                required: false,
                default: false,   
            },
        },
        computed: {
            ...mapState(useFeedStore, {
                paginator: 'getPaginator',
            }),
        },
        methods: {
            onPostDelete(postId) {
                this.$emit('delete-post', postId)
            },
            onLoadPagination(url) {
                this.$emit('load-posts', url)
            },
            onTriggerObserver() {

            },
            onCommentCreated(comment) {
                this.$emit('comment-created', comment)
            },
            onCommentDeleted(message) {
                this.$emit('comment-deleted', message)
            },
            onLikeItem(payload) {
                this.$emit('like-item', payload)
            },
            onShareItem(postVid) {
                this.$emit('share-item', postVid)
            }
        }

    }
</script>