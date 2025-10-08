<template>
   <WallWidget 
        v-if="owner" 
        :user="owner"
    ></WallWidget>
</template>

<script>
    import { mapActions, mapState } from 'pinia'
    import { useWallStore } from '~socializer/stores/wall.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import WallWidget from '~socializer/components/User/Wall.vue'
    import { useBreadcrumbService } from '~estarter/services/BreadcrumbService.js'

    export default {
        name: 'WallUser',
        components: {
            WallWidget,
        },
        mounted() {
            const slug = this.$route.params.slug || this.me.slug
            this.loadOwner(slug)
        },
        unmounted() {
            this.resetWall()
        },
        computed: {
            ...mapState(useWallStore, {
                owner: 'getOwner',
            }),
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
        },
        created() {
           const breadcrumbService = useBreadcrumbService()
           breadcrumbService.setBreadcrumb()
        },
        methods: {
            ...mapActions(useWallStore, [
                'loadOwner',
                'resetWall'
            ])
        }
    }
</script>