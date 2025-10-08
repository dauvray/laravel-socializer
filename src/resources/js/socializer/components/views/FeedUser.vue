<template>
    <FeedWidget class="container"></FeedWidget>
</template>

<script>

    import FeedWidget from '~socializer/components/User/Feed.vue'
    import { useBreadcrumbService } from '~estarter/services/BreadcrumbService.js'

    export default {
        name: "FeedUser",
        components: {
            FeedWidget,
        },
        created() {
           const breadcrumbService = useBreadcrumbService()
           breadcrumbService.setBreadcrumb()
        },
    }
</script>