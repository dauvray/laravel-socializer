<template>
    <div class="comments-list-tools">
        <CommentForm
            v-if="logged && canComment"
            :canberated="true"
            :btn-label="btnLabel"
            :displayCommentBtn="displayCommentBtn"
            @submit-comment="onSubmitComment"
            @cancel-submit-comment="onCancelSubmitComment"
            @signal-form-uniqid="onSignalFormUniqid"
        ></CommentForm>
        <CounterWidget
            v-if="total > 0"
            :aria-controls="targetId"
            :aria-expanded="false"
            :nbcomments="total"
            :counterLabel="counterLabel"
            :collapsed="collapsed"
            @display-comments="onDisplayComments"
        ></CounterWidget>
    </div>

        <CommentList
            v-show="!collapsed"
            ref="commentsList"
            :id="targetId"
            :comments="comments"
            :logged="logged"
            :commentable="commentable"
            :vertexid="vertexid"
            :pagination="pagination"
            @delete-comment="onDeleteComment"
            @comment-created="onSubCommentCreated"
            @trigger-intersected="onTriggerObserver"
            @load-pagination="onLoadPagination"
            @like-item="onSubmitLike"
        ></CommentList>


    <SpinnerWidget v-if="loading"></SpinnerWidget>
</template>

<script>

    import { mapState } from 'pinia'
    import { useCommentStore } from '~socializer/stores/comments.js'
    import { defineAsyncComponent, ref } from 'vue'
    import { useComment } from './composables/useComment.js'
    import SpinnerWidget from '~estarter/components/widgets/Spinners/Spinner1.vue'
    import { uniqueId } from '~estarter/services/helpers.js'

    export default {
        name: 'CommentListWrapper',
        components: {
            SpinnerWidget,
            CommentForm: defineAsyncComponent(() => import('~socializer/components/Comment/CommentForm.vue')),
            CounterWidget: defineAsyncComponent(() => import('~socializer/components/Comment/widgets/Counter.vue')),
            CommentList: defineAsyncComponent(() => import('~socializer/components/Comment/CommentList.vue')),
        },
        emits: [
            'comments-loaded',
            'comment-created',
            'comment-deleted',
            'signal-form-uniqid',
        ],
        inject: ['eventBus'],
        props: {
            logged: {
                type: Boolean,
                default: false
            },
            formvisible: {
                type: Boolean,
                required: false,
                default: true
            },
            commentable: {
                type: String,
                required: true,
            },
            vertexid: {
                type: String,
                required: true,
            },
            btnLabel: {
                type: String,
                required: false,
                default: 'Commenter'
            },
            counterLabel: {
                type: String,
                required: false,
                default: 'Commentaire'
            },
            nbcomments: {
                type: Number,
                required: false,
                default: null
            },
            urlload: {
                type: String,
                required: false,
                default: '/get-comments'
            },
            urlsend: {
                type: String,
                required: false,
                default: '/send-comment'
            },
            canComment: {
                type: Boolean,
                required: false,
                default: true,
            },
            autoload: {
                type: Boolean,
                required: false,
                default: false,   
            },
            pagination: {
                type: Boolean,
                required: false,
                default: false,   
            },
            displayCommentBtn: {
                type: Boolean,
                required: false,
                default: true
            },
            isParent:  {
                type: Boolean,
                required: false,
                default: false
            }
        },
        setup(props) {

            const { 
                channel,
                comments, 
                total,
                nextUrl,
                loading,
                loaded,
                loadComments, 
                reloadComments,
                submitComment,
                deleteComment,
                submitLike,
            } = useComment(props.commentable, props.vertexid, props.nbcomments)

            const showForm = ref(props.formvisible)
            const targetId = uniqueId('collapse')
            const collapsed = ref(true)

            return { 
                channel,
                showForm, 
                targetId,
                comments, 
                loading,
                loaded,
                nextUrl,
                total,
                collapsed,
                loadComments, 
                reloadComments,
                submitComment,
                deleteComment,
                submitLike,
            }
        },
        data() {
            return {
               
            }
        },
        watch: {
            loaded(value) {
                if(value) {
                    this.$emit('comments-loaded')
                }
            },
        },
        mounted() {
            if(this.autoload) {
                this.onDisplayComments()
            }
            this.eventBus.$on("close-comments-collapse", this.closeCollapse)
        },
        beforeUnmount() {
            this.eventBus.$off("close-comments-collapse", this.closeCollapse)
        },
        computed: {
            ...mapState(useCommentStore, {
                commentables: 'getCommentables',
            }),
        },
        methods: {
            onCancelSubmitComment() {
                this.showForm = false
            },
            async onSubmitComment(payload) {
               const comment = await this.submitComment(this.urlsend, payload)
               this.$emit('comment-created', comment)
            },
            onDisplayComments(url = null) {
                if(!this.loaded) {
                    this.loadComments(url || this.urlload) 
                }
                // only close other if parent ( not responses )
                if(this.isParent) {
                    this.eventBus.$emit("close-comments-collapse", this.targetId)
                }
                
                this.toggleCollapse()
            },
            toggleCollapse() {
                this.collapsed = !this.collapsed
            },
            async closeCollapse(targetId) {
                if(this.targetId !== targetId && this.isParent) {
                    this.collapsed = true
                } 
                // scroll to comments
                if(this.targetId === targetId && this.isParent) {
                    await this.$nextTick()
                    setTimeout(() => {
                        this.$refs.commentsList.scrollToMe()
                    }, 300)
                }
            },
            onDeleteComment(message, status = false) {

                if(status !== false) {
                    this.$emit('comment-deleted', message, status)
                } 
                 else {

                    let onOk = async () => {
                        await this.deleteComment(message.comment.id)
                        this.$emit('comment-deleted', message, true)
                    }

                    let onCancel = () => {}

                    window.AWN.confirm(
                        'Supprimer ce commentaire ?',
                        onOk,
                        onCancel,
                        {
                            labels :{
                                confirm: 'Supprimer',
                                confirmOk: "Valider",
                                confirmCancel: "Annuler",
                            }
                        }
                    )
                }
            },
            onTriggerObserver() {
                if(this.nextUrl) {
                    this.loadComments(this.nextUrl)
                }
            },
            onLoadPagination(url) {
                this.reloadComments(url)
            },
            onSubmitLike(payload) {
                this.submitLike(payload)
            },
            onSubCommentCreated(comment) {
                this.$emit('comment-created', comment)
            },
            onSignalFormUniqid(uniqid) {
                this.$emit('signal-form-uniqid', uniqid)
            }
        }
    }
</script>
<style>
    /* .v-enter-active,
    .v-leave-active {
        transition: all 0.5s ease;
    }

    .v-enter-from,
    .v-leave-to {
        opacity: 0;
        transform: translateY(-100px);
    } */
</style>
