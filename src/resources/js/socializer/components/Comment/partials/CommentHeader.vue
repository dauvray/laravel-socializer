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
    </div>
</template>

<script>

    import { defineAsyncComponent } from 'vue'
    import DateHelper from '~estarter/components/widgets/DateHelper.vue'
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
            profileurl: {
                type: String,
                required: false,
                default: ''
            },
        },
    }
</script>
