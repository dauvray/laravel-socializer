<template>
    <template v-if="users">
        <UsersList
            :users="users.data"
        ></UsersList>

        <!-- <Offcanvas direction="offcanvas-end">
            <template #header>Rechercher membre</template>
            <template #body>
                <SearchUsers></SearchUsers>
            </template>
        </Offcanvas> -->
    </template>
</template>

<script>
    import UsersList from '~socializer/components/Users/UsersList.vue'
    import { useSocialUserStore } from '~socializer/stores/socialUser.js'
    import { mapActions, mapState } from 'pinia'
    import { defineAsyncComponent } from '@vue/runtime-core'

    export default {
        name: 'UserList',
        components: {
            UsersList,
            Offcanvas: defineAsyncComponent(() => import('~estarter/components/widgets/Offcanvas.vue')),
            SearchUsers: defineAsyncComponent(() => import('~socializer/components/Users/Widgets/SearchUsers.vue')),
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