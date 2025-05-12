<template>
    <div 
        class="message-wrapper"
        :class="{'justify-content-end': isMe }">
        <Gravatar
            v-if="!isMe"
            class="me-2"
            size="small"
            style="width: 50px;"
            :user="item.author"
            :showStatus="true"
        ></Gravatar>
        <div class="message-outer">
            <div class="message-infos">
                <UserWallLink :user="item.author"></UserWallLink>
                <small>
                    <DateHelper
                        class="fst-italic fw-lighter"
                        :date="item.created_at"
                        format="since"
                    ></DateHelper>
                </small>
            </div>
            <div class="message-inner">
                <div class="message">
                    <div v-html="item.message"></div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import DateHelper from '~estarter/components/widgets/DateHelper.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'

    export default {
        name: "MessageWidget",
        components: {
            Gravatar,
            DateHelper,
            UserWallLink,
        },
        props: {
            item: {
                type: Object,
                required: true,
            }
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            isMe: function() {
                return this.item.author.slug === this.me.slug
            }
        }
    }
</script>