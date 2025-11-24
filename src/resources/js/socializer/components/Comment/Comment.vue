<template>
    <div class="comment">
        <Gravatar
            :user="comment.author"
            size="small"
        ></Gravatar>
        <div class="comment-inner">
            <CommentHeader
                :message="comment"
                :commentable="commentable"
                :vertexid="vertexid"
                @delete-comment="onDeleteComment"
            ></CommentHeader>
            <div class="comment-body">
                <div class="comment-content" v-html="comment.comment.content"></div>
                <div class="comment-tools">
                    <div class="post-footer-inner-left">
                        <LikeButtons
                            class="like-comment-btn"
                            :likes="comment.likes"
                            :dislikes="comment.dislikes"
                            @like-item="onLikeItem"
                        ></LikeButtons>
                        <button 
                            v-if="!isAuthor"
                            type="button"
                            class="btn"
                            @click="onShowCommentForm">
                            <IconWidget icon="comments"></IconWidget>
                        </button>
                    </div>
                    <div class="post-footer-inner-right">
                        <button
                            v-if="isAuthor"
                            type="button" 
                            class="delete-comment-btn"
                            @click="onDeleteComment"
                            ><IconWidget icon="trash-alt" title="supprimer"></IconWidget>
                        </button>
                    </div>
                </div>
            </div>
        
            <CommentFooter
                :logged="logged"
                :comment="comment"
                :commentable="commentable"
                :vertexid="vertexid"
                :formvisible="formvisible"
                @comment-created="onCommentCreated"
                @comment-deleted="onDeleteComment"
                @signal-form-uniqid="onSignalFormUniqid"
            ></CommentFooter>
        </div>
    </div>
</template>

<script>

    import CommentHeader from '~socializer/components/Comment/partials/CommentHeader.vue'
    import CommentFooter from '~socializer/components/Comment/partials/CommentFooter.vue'
    import LikeButtons from '~socializer/components/Comment/widgets/Like.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { mapState } from 'pinia'
    import { useMeStore } from '~estarter/stores/me.js'
     import Gravatar from '~estarter/components/widgets/Gravatar.vue'

    export default {
        name: 'Comment',
        inject: [
            'eventBus'
        ],
        components: {
            CommentHeader,
            CommentFooter,
            LikeButtons,
            IconWidget,
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
                 commentFormId: null,
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
            isAuthor: function() {
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
            onSignalFormUniqid(uniqid) {
                this.commentFormId = uniqid
            },
            onShowCommentForm() {
                this.eventBus.$emit("open-comment-form", this.commentFormId)
            }
        },
    }
</script>
