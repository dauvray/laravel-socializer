<template>
    <section id="socializer-wall"> 
        <CoverUser
            class="mb-5"
            :user="user"
        ></CoverUser>
        <div class="row">
            <div class="col-md-4">
                <PublishButton
                    v-if="canIPublish"
                    :feedFormId="feedOptions.feedFormId"
                    :feedId="feedOptions.feedId"
                ></PublishButton>
            </div>
            <div class="col-md-8">
                <FeedWidget
                    :user="user"
                    type="wall"
                    @feed-loaded="onFeedLoaded"
                ></FeedWidget>
            </div>
        </div>
    </section>
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
            },
        }
    }

</script>