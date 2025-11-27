<template>
    <div class="feed-user-wrapper">
        <div class="feed-user-inner">
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