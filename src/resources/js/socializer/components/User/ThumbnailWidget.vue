<template>
    <section>
        <div class="shadow-sm mb-3 h-100">
            <div class="row d-flex justify-content-center align-items-center h-100">
            
                    <div class="card" style="border-radius: 15px;">
                        <div class="card-body p-4">
                            <div class="d-flex">
                            <div class="flex-shrink-0">
                                <Gravatar
                                    :user="user"
                                    size="medium"
                                    image-class="img-fluid img-thumbnail"
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
                                        Followers
                                        </p>
                                        <p class="mb-0">{{  user.nb_followers - 1 }}</p>
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
            
            </div>
        </div>
    </section>
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