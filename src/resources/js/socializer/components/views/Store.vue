<template>
    <template v-if="applications">
        <div v-for="application in applications.data" :key="application.id">
        <h2>{{ application.infos.name }}</h2>
        <div v-html="application.infos.description"></div>
    </div>
    </template>

</template>

<script>
    import { useStoreStore } from '~socializer/stores/store.js'
    import { mapActions, mapState } from 'pinia'

    export default {
        name: 'Store',
        created() {
            this.loadApplications()
        },
        computed: {
            ...mapState(useStoreStore, {
                applications: 'getApplications',
            })
        },
        methods: {
            ...mapActions(useStoreStore, [
                'loadApplications',
            ]),
        }
    }
</script>