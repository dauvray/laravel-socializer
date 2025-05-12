<template>
    <ul class="room-users-list">
        <li v-for="user in users" 
            :key="user.id"
            class="chatters">
            <span class="d-flex align-items-center badge text-bg-light me-2">
                <Gravatar
                    class="me-2"
                    size="small"
                    style="width: 30px;"
                    :user="user"
                    :showStatus="false"
                ></Gravatar>
                <UserWallLink :user="user"></UserWallLink>
            </span>
        </li>
    </ul>
</template>

<script>
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'

    export default {
        name: 'RoomUsersList',
        props: {
            users: {
                type: Array,
                required: true
            }
        },
        components: {
            Gravatar,
            UserWallLink
        },
    }   
</script>