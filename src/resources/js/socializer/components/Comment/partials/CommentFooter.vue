<template>
    <div class="comment-footer">
        <CommentListWrapper
            btn-label="Répondre"
            counter-label="Réponse"
            :logged="logged"
            :commentable="commentable"
            :vertexid="vertexid"
            :formvisible="formvisible"
            :nbcomments="commentsCounter"
            :can-comment="!isAuthor"
            :displayCommentBtn="displayCommentBtn"
            urlload="/get-sub-comments"
            urlsend="/send-sub-comment"
            @comment-created="onCommentCreated"
            @comment-deleted="onCommentDeleted"
            @signal-form-uniqid="onSignalFormUniqid"
        ></CommentListWrapper> 
    </div>
</template>

<script>

    import { mapState } from 'pinia'
    import { useMeStore } from '~estarter/stores/me.js'
    import { defineAsyncComponent } from 'vue'
    import CommentListWrapper from '../CommentListWrapper.vue'

    export default {
        name: "CommentFooter",
        components: {
            CommentListWrapper,
            CommentList: defineAsyncComponent(() => import('~socializer/components/Comment/CommentList.vue')),
            CounterWidget: defineAsyncComponent(() => import('~socializer/components/Comment/widgets/Counter.vue')),
        },
        emits: [
            'comment-created',
            'comment-deleted',
            'signal-form-uniqid',
        ],
        props: {
            comment: {
                type: Object,
                required: true
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
                default: false
            },
            canberated: {
                type: Boolean,
                default: false
            },
            canbeliked: {
                type: Boolean,
                default: true
            },
            canbereported: {
                type: Boolean,
                default: true
            },
            canbedeleted: {
                type: Boolean,
                default: false
            },
            formvisible: {
                type: Boolean,
                default: false
            },
            postlikeurl: String,
            postdislikeurl: String,
            postreporturl: String,
            profileurl: {
                type: String,
                required: false,
                default: ''
            },
            displayCommentBtn: {
                type: Boolean,
                required: false,
                default: false
            },
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            isAuthor: function() {
                if(this.me) {
                    return `user${this.me.id}` == this.comment.author.id
                }
                return false
            },
            commentsCounter: function() {
                return this.comment.count
            },
        },
        methods: {
            onCommentCreated(comment) {
                this.$emit('comment-created', comment)
            },
            onCommentDeleted(message, status) {
                this.$emit('comment-deleted', message, status)
            },
            onSignalFormUniqid(uniqid) {
                 this.$emit('signal-form-uniqid', uniqid)
            },
        }
    }
</script>
