<template>
    <div id="socializer-wall"> 
        <CoverUser :user="user"></CoverUser>
        <div class="wall-wrapper">
            <div class="wall-sidebar">
                <UserGroups :groups="groups"></UserGroups>
            </div>

            <FeedWidget
                :user="user"
                type="wall"
                :canPublish="canPublish"
                @feed-loaded="onFeedLoaded"
            ></FeedWidget>
        </div>
    </div>
</template>

<script>

    import CoverUser from '~socializer/components/User/Cover.vue'
    import FeedWidget from '~socializer/components/Feed/Feed.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { useWallStore } from '~socializer/stores/wall.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'
    import { defineAsyncComponent } from 'vue'


    const feedOptions = {
        feedId: null,
        feedFormId: null,
    }

    export default {
        name: 'Wall',
        components: {
            CoverUser,
            FeedWidget,
            IconWidget,
            PublishButton: defineAsyncComponent(() => import('~socializer/components/User/widgets/PublishButton.vue')),
            OwnedServers: defineAsyncComponent(() => import('~socializer/components/User/widgets/OwnedServers.vue')),
            UserGroups: defineAsyncComponent(() => import('~socializer/components/User/widgets/UserGroups.vue')),
        },
        props: {
            user: {
                type: Object,
                required: true,
            }
        },
        data() {
            return {
                feedOptions: {...feedOptions}, 
                loaded: false,
            }
        },
        beforeUnmount() {
            this.feedOptions = {...feedOptions}
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
                groups: 'getGroups',
            }),
            ...mapState(useWallStore, {
                wallOwner: 'getOwner',
            }),
            canPublish: function() {
                return this.me.vertexid === this.wallOwner.vertexid
            },
        },
        methods: {
            onFeedLoaded(feed) {
                this.feedOptions.feedId = feed.id
                this.feedOptions.feedFormId = feed.questionnaire
                this.loaded = true
            },
        }
    }

</script>