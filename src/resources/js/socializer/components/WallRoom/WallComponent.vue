<template>
    <Teleport to="#room-header-tools">
        <PublishButton
            :feedFormId="feedOptions.feedFormId"
            :feedId="feedOptions.feedId"
            :userOwner="false"
        ></PublishButton>
    </Teleport>

    <FeedWidget
        class="m-2"
        :user="{identifier: currentRoom.id}"
        type="wall"
        owner="room"
        @feed-loaded="onFeedLoaded"
    ></FeedWidget>
</template>

<script>
    import FeedWidget from '~socializer/components/Feed/Feed.vue'
    import PublishButton from '~socializer/components/User/widgets/PublishButton.vue'
    import { mapState } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'

    export default {
        name: 'WallComponent',
        components: {
            FeedWidget,
            PublishButton,
        },
        data() {
            return {
                feedOptions: {
                    feedId: null,
                    feedFormId: null,
                }
            }
        },
        computed: {
            ...mapState(useServerStore, {
                currentRoom: 'getCurrentRoom',
            }),
        },
        methods: {
            onFeedLoaded(feed) {
                this.feedOptions.feedId = feed.id
                this.feedOptions.feedFormId = feed.questionnaire
            },
        },
    }
</script>