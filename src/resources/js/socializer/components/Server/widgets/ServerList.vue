<template>
    <section>
        <ul class="list-group list-group-flush">
            <li v-for="(server, idx) in registeredServers" 
                :key="server.id" 
                class="list-group-item">
                <button 
                    type="button" 
                    class="btn btn-link"
                    @click="onChangeServer(server.id)"
                >{{ server.name }}</button>
            </li>
        </ul>
    </section>
</template>

<script>
    import { mapActions, mapState } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'

    export default {
        name: 'ServerList',
        emits: [
            'change-server',
        ],
        computed: {
            ...mapState(useServerStore, {
                registeredServers: 'getRegisteredServers',
            }),
            baseUrl: function() {
                return window.router_base_url
            }
        },
        created() {
            this.loadRegisteredServers()
        },
        methods: {
            ...mapActions(useServerStore, [
                'loadRegisteredServers',
            ]),
            onChangeServer(serverId) {
                this.$emit('change-server', serverId)
            }
        }
    }
</script>