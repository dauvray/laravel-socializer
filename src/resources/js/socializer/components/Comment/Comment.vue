<template>
    <div class="d-flex align-items-start">

        <Gravatar
            class="me-3"
            :user="comment.author"
            size="small"
        ></Gravatar>

        <div class="comment flex-grow-1">
            <div class="card">
                <CommentHeader
                    class="card-header"
                    :message="comment"
                    :commentable="commentable"
                    :vertexid="vertexid"
                    @delete-comment="onDeleteComment"
                ></CommentHeader>
                <CommentBody
                    class="card-body"
                    :item="comment.comment"
                ></CommentBody>
            </div>
            <CommentFooter
                class="card-footer"
                :logged="logged"
                :comment="comment"
                :commentable="commentable"
                :vertexid="vertexid"
                :formvisible="formvisible"
                @like-item="onLikeItem"
                @comment-created="onCommentCreated"
                @comment-deleted="onDeleteComment"
            ></CommentFooter>
        </div>
    </div>
</template>

<script>

    import CommentHeader from '~socializer/components/Comment/partials/CommentHeader.vue'
    import CommentBody from '~socializer/components/Comment/partials/CommentBody.vue'
    import CommentFooter from '~socializer/components/Comment/partials/CommentFooter.vue'
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'

    export default {
        name: 'Comment',
        components: {
            CommentHeader,
            CommentBody,
            CommentFooter,
            Gravatar,
        },
        emits: [
            'delete-comment',
            'comment-created',
            'like-item',
        ],
        data() {
            return {
                formvisible: false,
            }
        },
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
        },
        methods: {
            onDeleteComment(message, status = false) {
                this.$emit('delete-comment', message, status)
            },
            onCommentCreated(comment, status) {
                this.$emit('comment-created', comment, status)
            },
            onLikeItem(payload) {
                this.$emit('like-item', payload)
            },
        },
    }
</script>
