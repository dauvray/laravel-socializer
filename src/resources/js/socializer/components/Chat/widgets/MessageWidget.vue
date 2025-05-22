<template>
    <div class="message-wrapper" 
        :class="{'justify-content-end': isMe }">
        <Gravatar
            v-if="!isMe"
            class="me-2"
            size="small"
            style="width: 50px;"
            :user="item.author"
            :showStatus="true"
        ></Gravatar>
        <div class="message-outer"  ref="message">
            <div class="message-infos" >
                <UserWallLink :user="item.author"></UserWallLink>
                <small>
                    <DateHelpr
                        class="fst-italic fw-lighter"
                        :date="item.created_at"
                        format="since"
                    ></DateHelpr>
                </small>
            </div>
            <div class="message-inner">

                <div class="message"  >
                    <div v-html="item.message"></div>
                </div>
            </div>
            <MessageEmoji :emojis="emojis"></MessageEmoji>
        </div>
        <MessageTools 
            :style="toolsStyle"
            :message="item"
            @selected-emoji="onSelectedEmoji"
            @delete-message="onDeleteMessage"
        ></MessageTools>
    </div>
</template>

<script>
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import DateHelper from '~estarter/components/widgets/DateHelper.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'
    import MessageTools from './partials/MessageTools.vue'
    import MessageEmoji from './partials/MessageEmoji.vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'
    import { computePosition, offset, flip, shift } from '@floating-ui/dom'

    export default {
        name: "MessageWidget",
        emits: [
            'selected-emoji',
            'delete-message',
        ],
        components: {
            Gravatar,
            DateHelper,
            UserWallLink,
            MessageTools,
            MessageEmoji,
        },
        props: {
            item: {
                type: Object,
                required: true,
            }
        },
        data() {
            return {
                toolsStyle: {},
            }
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            isMe: function() {
                return this.item.author.slug === this.me.slug
            },
            emojis: function() {
                if(this.item.extras) {
                    return this.item.extras.emojis
                }
                 return {}
            },
        },
        mounted() {
            this.$nextTick(() => {
                this.updatePosition()
            })
        },
        methods: {
            async updatePosition() {
                await this.$nextTick()
                if (!this.$refs.message || !this.$refs.tools) return

                // pour utiliser le ref de MessageTools
                const referenceEl = this.$refs.tools.value?.rootEl

                const { x, y } = await computePosition(this.$refs.message, referenceEl, {
                    placement: 'left',
                    middleware: [
                    offset(3),
                    flip(),
                    shift({ padding: 8 }),
                    ]
                })

                this.toolsStyle = {
                    top: `${y}px`,
                    left: `${x}px`,
                }
            },
            onSelectedEmoji(emoji) {
               this.$emit('selected-emoji', emoji, this.item)
            },
            onDeleteMessage(messageId) {
                this.$emit('delete-message', messageId)
            },
        },
    }
</script>