<template>      
    <div class="card user-thumbnail-wrapper">
        <div class="user-thumbnail-inner">
            <UserBadge :user="user"></UserBadge>
            <span class="followers-count">
                Followers : {{  user.nb_followers - 1 }}
            </span>
            <FollowButton
                v-if="!user.is_me"
                :user="user"
            ></FollowButton>
        </div>
    </div>
</template>

<script>
    import UserBadge from '~socializer/components/User/Badge.vue'
    import FollowButton from '~socializer/components/User/widgets/FollowButton.vue'

    export default {
        name: 'ThumbnailWidget',
        components: {
            FollowButton,
            UserBadge,
        },
        props: {
            user: {
                type: Object,
                required: true
            }
        },

        data() {
            return {

            }
        },
        methods: {

        }
    }
</script>