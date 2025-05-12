<template>
       <CommentItem
            v-for="(comment, idx) in comments"
            :key="comment.comment.id"
            :comment="comment"
            :commentable="commentable"
            :vertexid="comment.comment.id"
            :logged="logged"
            @comment-created="onCommentCreated"
            @delete-comment="onDeleteComment"
            @like-item="onLikeItem"
       ></CommentItem>

       <PaginationOrIntersection
            :paginator="paginator"
            :pagination="pagination"
            @load-page="onLoadPagination"
            @trigger-intersected="onTriggerObserver">
        </PaginationOrIntersection>

  </template>

<script>
    import { useCommentStore } from '~socializer/stores/comments.js'
    import { mapState } from 'pinia'
    import CommentItem from '~socializer/components/Comment/Comment.vue'
    import PaginationOrIntersection from '~socializer/components/widgets/PaginationOrIntersection.vue'

    export default {
        name: 'CommentList',
        components: {
            CommentItem,
            PaginationOrIntersection,
        },
        emits: [
            'delete-comment',
            'comment-created',
            'trigger-intersected',
            'load-pagination',
            'like-item',
        ],
        props: {
            comments: {
                type: Array,
                require : true
            },
            commentable: {
                type: String,
                required: true
            },
            vertexid: {
                type: String,
                required: true,
            },
            logged: {
                type: Boolean,
                required: false,
                default: false
            },
            pagination: {
                type: Boolean,
                required: false,
                default: false,   
            },
        }, 
        computed: {
            ...mapState(useCommentStore, {
                getCommentable: 'findCommentable',
            }),
            paginator: function() {
                return this.getCommentable(this.vertexid)
            },
        },
        methods: {
            onDeleteComment(message, status = false) {
                this.$emit('delete-comment', message, status)
            },
            onCommentCreated(comment) {
                this.$emit('comment-created', comment)
            },
            onTriggerObserver() {
                this.$emit('trigger-intersected')
            },
            onLikeItem(payload) {
               this.$emit('like-item', payload)
            },
            onLoadPagination(url) {
                this.$emit('load-pagination', url)
            }
        }
    }
</script>


