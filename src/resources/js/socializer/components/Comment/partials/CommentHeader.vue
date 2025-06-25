<template>
    <div class="comment-header p-2">

        <div class="d-flex">
            <UserWallLink
                :user="message.author"
            ></UserWallLink>
            <DateHelper
                class="ms-2 me-2 text-muted fw-light"
                :date="message.comment.created_at"
                :format="'since'"
            ></DateHelper>
        </div>

        <button
            v-if="canDelete"
            type="button" 
            class="btn btn-sm btn-link"
            @click="onSelfDelete"
            ><IconWidget icon="trash-alt" title="supprimer"></IconWidget>
        </button>
    
<!--        <rating-buttons-->
<!--            v-if="comment.parent_id == 0"-->
<!--            :canberated="canberated"-->
<!--            :ratable="comment"-->
<!--            :parent="commentable"-->
<!--        ></rating-buttons>-->
    </div>
</template>

<script>

    import { defineAsyncComponent } from 'vue'
    import DateHelper from '~estarter/components/widgets/DateHelper.vue'
    import { mapState } from 'pinia'
    import { useMeStore } from '~estarter/stores/me.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'

    export default {
        name: 'CommentHeader',
        emits: [
            'delete-comment',
        ],
        components: {
            DateHelper,
            IconWidget,
            UserWallLink,
            LikeButtons: defineAsyncComponent(() => import('~socializer/components/Comment/widgets/Like.vue')),
           // RatingButtons: () => import('vuejs-eblogger/components/widgets/Comment/widgets/Rate'),
        },
        props: {
            message: {
                type: Object,
                required: true
            },
            commentable: {
                type: String,
                required: true
            },
            // canberated: {
            //     type: Boolean,
            //     default: false
            // },
            profileurl: {
                type: String,
                required: false,
                default: ''
            },
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            canDelete: function() {
                if(this.me) {
                    return `user${this.me.id}` === this.message.author.id
                }
            },
        },
        methods: {
            onSelfDelete() {
                // false because not treated
                this.$emit('delete-comment', this.message, false)
            },
        }
    }
</script>
