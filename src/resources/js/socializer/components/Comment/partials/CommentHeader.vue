<template>
    <div class="comment-header">
        <UserWallLink
            :user="message.author"
        ></UserWallLink>
        <DateHelper
            :date="message.comment.created_at"
            :format="'since'"
        ></DateHelper>
    </div>
</template>

<script>

    import { defineAsyncComponent } from 'vue'
    import DateHelper from '~estarter/components/widgets/DateHelper.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    
    export default {
        name: 'CommentHeader',
        emits: [
            'delete-comment',
        ],
        components: {
            Gravatar,
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
