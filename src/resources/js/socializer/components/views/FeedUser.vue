<template>
    <div class="row">
        <div class="col-4">
            <FeedWidget></FeedWidget>
        </div>
    </div>
   
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