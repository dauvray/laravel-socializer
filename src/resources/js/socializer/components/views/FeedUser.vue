<template>
    <div class="row">
        <div class="col-4">
            <FeedWidget></FeedWidget>
        </div>
    </div>
   
</template>

<script>

    import FeedWidget from '~socializer/components/User/Feed.vue'
  
    export default {
        name: "FeedUser",
        components: {
            FeedWidget,
        },
    }
</script>