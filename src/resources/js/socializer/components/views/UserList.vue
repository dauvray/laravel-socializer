<template>
    <UsersList
        v-if="users"
        :users="users.data"
    ></UsersList>
</template>

<script>
    import UsersList from '~socializer/components/Users/UsersList.vue'
    import { useSocialUserStore } from '~socializer/stores/socialUser.js'
    import { mapActions, mapState } from 'pinia'

    export default {
        name: 'UserList',
        components: {
            UsersList,
        },
        computed: {
            ...mapState(useSocialUserStore, {
                users: 'getUsers',
            })
        },
        mounted() {
            this.loadUsers()
        },
        methods: {
            ...mapActions(useSocialUserStore, [
                'loadUsers',
            ]),
        }
    }
</script>