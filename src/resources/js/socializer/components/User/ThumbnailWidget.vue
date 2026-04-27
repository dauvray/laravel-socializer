<template>      
    <div class="card user-thumbnail-wrapper">
        <div class="user-thumbnail-inner">
            <UserBadge :user="user"></UserBadge>
            <UserGroups :groups="user.groups"></UserGroups>
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
    import { defineAsyncComponent } from 'vue'

    export default {
        name: 'ThumbnailWidget',
        components: {
            FollowButton,
            UserBadge,
            UserGroups: defineAsyncComponent(() => import('~socializer/components/User/widgets/UserGroups.vue')),
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