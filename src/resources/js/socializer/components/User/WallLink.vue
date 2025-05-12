<template>
    <a v-if="!isSpa" 
        :href="$router.resolve({ name: 'WallUser', params: { slug: user.slug } }).href"
        > {{ user.name }}</a>
    <RouterLink 
        v-else-if="user.slug"
        :to="{ name: 'WallUser', params: { slug: user.slug } }">
        {{ user.name }}
    </RouterLink>
    <template v-else>{{ user.name }}</template>
</template>

<script>

    import { mapState } from 'pinia'
    import { useApplicationStore } from '~estarter/stores/application.js'

    export default {
        name: 'WallLink',
        props: {
            user: {
                type: Object,
                required: true
            },
            reloadPage: {
                type: Boolean,
                required: true,
            }
        },
        computed: {
            ...mapState(useApplicationStore, {
                isSpa: 'getIsSpa',
            }),
        },
    }
</script>