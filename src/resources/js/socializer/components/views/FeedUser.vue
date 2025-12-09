<template>
    <div class="view-wrapper">
        <div class="feed-user-view">
            <FeedWidget v-if="me"
                :user="me"
                :canPublish="true"
            ></FeedWidget>
        </div>
    </div>
</template>

<script>

    import FeedWidget from '~socializer/components/Feed/Feed.vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'
  
    export default {
        name: "FeedUser",
        components: {
            FeedWidget,
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
        },
    }
</script>