<template>
    <div id="socializer-wall"> 
        <CoverUser :user="user"></CoverUser>
        <section class="wall-wrapper">
            <div class="wall-tools">
                <PublishButton
                    v-if="canIPublish && loaded"
                    :feedFormId="feedOptions.feedFormId"
                    :feedId="feedOptions.feedId"
                ></PublishButton>
            </div>
            <OwnedServers 
                class="wall-owned-servers"
                @check-server-access="onCheckServerAccess"
            ></OwnedServers>
            <FeedWidget
                class="feed-wrapper"
                :user="user"
                type="wall"
                @feed-loaded="onFeedLoaded"
            ></FeedWidget>
        </section>
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
            }),
            ...mapState(useWallStore, {
                wallOwner: 'getOwner',
            }),
            canIPublish: function() {
                return this.me.vertexid === this.wallOwner.vertexid
            },
        },
        methods: {
            onFeedLoaded(feed) {
                this.feedOptions.feedId = feed.id
                this.feedOptions.feedFormId = feed.questionnaire
                this.loaded = true
            },
            onCheckServerAccess(hasAccess) {
                if(!hasAccess) {
                    this.$toast.error("Vous n'avez pas accès à ce domaine.")
                }
            }
        }
    }

</script>