<template>
    <div class="d-flex align-items-end mb-1">
        <Gravatar
            class="me-2"
            size="small"
            style="width: 35px;"
            :user="user"
            :showStatus="true"
        ></Gravatar>
        <UserWallLink
            :user="user"
        ></UserWallLink>
        <span class="ps-2">a partagé :</span>
    </div>
</template>

<script>
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'

    export default {
        name: 'SharedThumbnail',
        props: {
            user: {
                type: Object,
                required: true
            }
        },
        components: {
           Gravatar,
           UserWallLink,
        }
    }
</script>