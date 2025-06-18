<template>
    <ul class="room-users-list">
        <li v-for="user in users" 
            :key="user.id"
            class="chatters">
            <div class="chat-user-badge">
                <Gravatar
                    class="me-2"
                    size="small"
                    style="width: 30px;"
                    :user="user"
                    :showStatus="false"
                ></Gravatar>
                <UserWallLink :user="user"></UserWallLink>
            </div>
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