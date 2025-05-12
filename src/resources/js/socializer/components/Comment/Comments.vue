<template>
   <div v-if="canbecommented" 
        class="comments-list">
        <div class="d-flex" v-if="showTitleFilters">
            <h2 class="fs-4">{{ commentTitle }}</h2>
            <CommentsFilter
                v-if="hasComments"
                class="w-100"
                :commentable="commentable"
                :vertexid="vertexid">
            </CommentsFilter>
        </div>

        <ConnectionBtn 
            v-if="!logged"
            :label="commentBtnTitle"
        ></ConnectionBtn>

        <CommentListWrapper
            :logged="logged"
            :commentable="commentable"
            :vertexid="vertexid"
            :formvisible="formvisible"
            :autoload="autoload"
            :pagination="pagination"
            :nbcomments="nbcomments"
            @comments-loaded="onCommentsLoaded"
            @comment-created="onCommentCreated"
            @comment-deleted="onCommentDeleted"
        ></CommentListWrapper>
    </div>
</template>

<script>

    import { defineAsyncComponent } from 'vue'
    import { mapActions, mapState } from 'pinia'
    import { useMeStore } from '~estarter/stores/me.js'
    import { useApplicationStore } from '~estarter/stores/application.js'
    import { useCommentStore } from '~socializer/stores/comments.js'
    import CommentListWrapper from './CommentListWrapper.vue'

     export default {
        name: 'Comments',
        emits: [
            'comments-loaded',
            'comment-created',
            'comment-deleted',
        ],
        components: {
            CommentListWrapper,
            ConnectionBtn: defineAsyncComponent(() => import('~estarter/components/widgets/Connection.vue')),
            CommentsFilter: defineAsyncComponent(() => import('./partials/CommentsFilter.vue')),
        },
        props: {
            commentable: {
                type: String,
                required: true,
            },
            commentTitle: {
                type: String,
                required: false,
                default: 'Commentaires'
            },
            showTitleFilters: {
                type: Boolean,
                required: false,
                default: true
            },
            commentBtnTitle: {
                type: String,
                required: false,
                default: 'Connectez-vous pour commenter'
            },
            canbecommented: {
                type: Boolean,
                required: false,
                default: true
            },
            formvisible: {
                type: Boolean,
                required: false,
                default: false
            },
            vertexid: {
                type: String,
                required: true,
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
            isSpa : {
                type: Boolean,
                required: false,
                default: true, 
            },
            nbcomments: {
                type: Number,
                required: false,
                default: null
            },
        },
        computed: {
            ...mapState(useMeStore, {
                logged: 'logged',
            }),
            ...mapState(useCommentStore, {
                hasComments: 'hasComments'
            }),
        },
        created() {
            this.setIsSPa(this.isSpa)
        },
        beforeUnmount() {
            this.resetComments()
        },
        methods: {
            ...mapActions(useApplicationStore, [
                'setIsSPa',
            ]),
            ...mapActions(useCommentStore, [
                'resetComments',
            ]),
            onCommentsLoaded() {
                this.$emit('comments-loaded')
            },
            onCommentCreated(comment) {
                this.$emit('comment-created', comment)
            },
            onCommentDeleted(message) {
                this.$emit('comment-deleted', message)
            },
        }
    }
</script>
