<template>      
    <div class="card" style="border-radius: 15px;">
        <div class="card-body">
            <div class="d-flex">
                <div class="flex-shrink-0">
                    <Gravatar
                        :user="user"
                        size="medium"
                    ></Gravatar>
                </div>
                <div class="flex-grow-1 ms-3">
                    <h5 class="mb-1">
                        <UserWallLink :user="user"></UserWallLink>
                    </h5>
                    <p class="mb-2 pb-1">
                        {{ user.function }}
                    </p>
                    <div class="d-flex justify-content-start rounded-3 p-2 mb-2 bg-body-tertiary">

                        <div class="px-3">
                            <p class="small text-muted mb-1">
                                Followers {{  user.nb_followers - 1 }}
                            </p>

                        </div>

                    </div>
                    <div class="d-grid gap-2 d-md-block">
                        <FollowButton
                            v-if="!user.is_me"
                            :user="user"
                        ></FollowButton>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>

    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'
    import FollowButton from '~socializer/components/User/widgets/FollowButton.vue'

    export default {
        name: 'ThumbnailWidget',
        components: {
            Gravatar,
            FollowButton,
            UserWallLink,
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