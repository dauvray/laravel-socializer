<template>

    <div class="feed-user py-3">

        <PublishButton
            v-if="feed"
            :feedFormId="feed.questionnaire"
            :feedId="feed.id"
        ></PublishButton>
        <FeedWidget
            v-if="me"
            :user="me"
             @feed-loaded="onFeedLoaded"
        ></FeedWidget>
    </div>
</template>

<script>
    import FeedWidget from '~socializer/components/Feed/Feed.vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'
    import { defineAsyncComponent } from 'vue'

    export default {
        name: 'Feed',
        components: {
            FeedWidget,
            PublishButton: defineAsyncComponent(() => import('~socializer/components/User/widgets/PublishButton.vue')),
        },
        data() {
            return {
                feed: null
            }
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
        },
        methods: {
            onFeedLoaded(feed) {
                this.feed = feed
            },
        }
    }
</script>