<template>
    <div v-if="groups.length" class="badges-user-groups">
        <button v-for="(group, index) in groups" 
            :key="index"
            class="btn btn-sm btn-info"
            @click="onLoadServer(group.server_id)">
            {{ group.name }}
        </button>
    </div>
</template>

<script>
    import { checkServerAccess } from '~socializer/services/helpers.js'
    export default {
        name: 'UserGroups',
        inject: ['AWN'],
        props: {
            groups: {
                type: Array,
                required: false,
                default: () => []
            }
        },
        methods: {
            async onLoadServer(serverId) {
                const hasAccess = await checkServerAccess(serverId)
                if(hasAccess) {
                    this.$router.push({ name: 'server', params: { serverId }})
                } else {
                    this.AWN.alert("Vous n'avez pas accès à ce domaine", {})
                   
                }
            }
        }
    }
</script>