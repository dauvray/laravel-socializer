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
    import { useBreadcrumbService } from '~estarter/services/BreadcrumbService.js'

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
        created() {
           const breadcrumbService = useBreadcrumbService()
           breadcrumbService.setBreadcrumb()
        },
        methods: {
            ...mapActions(useSocialUserStore, [
                'loadUsers',
            ]),
        }
    }
</script>