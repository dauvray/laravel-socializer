<template>
    <SharedThumbnail 
        v-if="item.post.type == 'shared'"
        :user="item.post.shared_by">
    </SharedThumbnail>
    <div class="card">
        <div class="card-header p-1">
            <div class="d-flex align-items-end">
                <Gravatar
                    class="me-2"
                    :user="item.author"
                    size="small"
                ></Gravatar>
                <div class="d-flex flex-column">
                    <UserWallLink
                        :user="item.author"
                    ></UserWallLink>
                    <small>{{  item.author.function }}</small>
                </div>
                <DateHelper
                    class="ms-2 me-2 text-muted fw-light"
                    :date="item.post.created_at"
                    :format="'since'"
                ></DateHelper>
            </div>
            <button
                v-if="canDelete"
                type="button" 
                class="btn btn-sm btn-link"
                @click="onPostDelete"
                ><IconWidget icon="trash-alt" title="supprimer"></IconWidget>
            </button>
        </div>

        <div class="card-body">
            <div class="card-text" v-html="item.post.content"></div>
        </div>
        
        <div class="card-footer">
            <LikeButtons
                :likes="item.post.likes"
                :dislikes="item.post.dislikes"
                @like-item="onLikeItem"
            ></LikeButtons>
            <ShareButton
                v-if="canShare"
                @share-item="onSharePost"
            ></ShareButton>
            <span v-if="item.post.shares">{{ item.post.shares }} republication</span>
        </div>
    </div>
    <socializer-comments
        :canbecommented="true" 
        :formvisible="false" 
        :autoload="false"
        :pagination="true"
        :showTitleFilters="false"
        :nbcomments="item.post.nb_comments"
        :vertexid="`post${item.post.id}`"
        :commentable="item.post.identifier"
        @comment-created="onCommentCreated"
        @comment-deleted="onCommentDeleted"
    ></socializer-comments>
</template>

<script>

    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'
    import { defineAsyncComponent } from 'vue'
    import LikeButtons from '~socializer/components/Comment/widgets/Like.vue'
    import ShareButton from '~socializer/components/Post/widgets/ShareButton.vue'
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'
    import DateHelper from '~estarter/components/widgets/DateHelper.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'Post',
        inject: ['AWN'],
        emits: [
            'delete-post',
            'comment-created',
            'comment-deleted',
            'like-item',
            'share-item',
        ],
        components: {
            Gravatar,
            UserWallLink,
            DateHelper,
            IconWidget,
            LikeButtons,
            ShareButton,
            SharedThumbnail: defineAsyncComponent(() => import('./widgets/SharedThumbnail.vue')),
        },
        props: {
            item: {
                type: Object,
                required: true
            }
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            canDelete: function() {
                if(this.me) {
                    return this.me.slug === this.item.author.slug
                }
            },
            canShare: function() {
                return this.item.author.slug !== this.me.slug && this.item.post.shared_by.slug !== this.me.slug
            },
        },
        methods: {
            onPostDelete() {
                let onOk = () => {
                    this.$emit('delete-post', this.item.post.id)
                    }
                let onCancel = () => {}

                this.AWN.confirm(
                    'Etes-vous certain ?',
                    onOk,
                    onCancel,
                    {
                        labels :  {
                            confirm: 'Supprimer',
                            confirmOk: "Valider",
                            confirmCancel: "Annuler",
                        }
                    }
                )
            },
            onCommentCreated(comment) {
                this.$emit('comment-created', comment)
            },
            onCommentDeleted(message) {
                this.$emit('comment-deleted', message)
            },
            onLikeItem(value) {
                this.$emit('like-item', { value , itemVid: this.item.post.vertexid })
            },
            onSharePost() {
                this.$emit('share-item', this.item.post.vertexid)
            },
        }
    }
</script>

<style lang="scss" >
    .slz-post-link{
        display: block;
        text-decoration: none;
        color: #000;
    }
</style>