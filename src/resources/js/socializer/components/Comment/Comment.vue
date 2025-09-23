<template>
    <div class="d-flex align-items-start">

        <Gravatar
            class="me-3"
            :user="comment.author"
            size="small"
        ></Gravatar>

        <div class="comment flex-grow-1">
            <div class="post-wrapper">
                <CommentHeader
                    class="post-header"
                    :message="comment"
                    :commentable="commentable"
                    :vertexid="vertexid"
                    @delete-comment="onDeleteComment"
                ></CommentHeader>
                <CommentBody
                    class="post-body"
                    :item="comment.comment"
                ></CommentBody>
                <div class="post-footer">
                    <div class="post-footer-inner-left">
                        <LikeButtons
                            :likes="comment.likes"
                            :dislikes="comment.dislikes"
                            @like-item="onLikeItem"
                        ></LikeButtons>
                    </div>
                    <div class="post-footer-inner-right">
                        <button
                            v-if="canDelete"
                            type="button" 
                            class="delete-btn"
                            @click="onDeleteComment"
                            ><IconWidget icon="trash-alt" title="supprimer"></IconWidget>
                        </button>
                    </div>
                </div>
            </div>
            <CommentFooter
                class="post-footer"
                :logged="logged"
                :comment="comment"
                :commentable="commentable"
                :vertexid="vertexid"
                :formvisible="formvisible"
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
    import LikeButtons from '~socializer/components/Comment/widgets/Like.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { mapState } from 'pinia'
    import { useMeStore } from '~estarter/stores/me.js'

    export default {
        name: 'Comment',
        components: {
            CommentHeader,
            CommentBody,
            CommentFooter,
            Gravatar,
            LikeButtons,
            IconWidget,
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
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            canDelete: function() {
                if(this.me) {
                    return this.me.vertexid == this.comment.author.id
                }
            },
        },
        methods: {
            onDeleteComment() {
                // false because not treated
                this.$emit('delete-comment', this.comment, false)
            },
            onCommentCreated(comment, status) {
                this.$emit('comment-created', comment, status)
            },
            onLikeItem(value) {
                this.$emit('like-item', { value , itemVid: this.comment.comment.id })
            },
        },
    }
</script>
