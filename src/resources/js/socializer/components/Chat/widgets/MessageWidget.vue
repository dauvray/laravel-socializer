<template>
    <div class="message-wrapper" 
        :class="{'is-me': isMe }">
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
                    <DateHelper
                        class="fst-italic fw-lighter"
                        :date="item.created_at"
                        format="since"
                    ></DateHelper>
                </small>
            </div>

            <MessageContent
                v-if="!updating" 
                :class="{'is-me': isMe }"
                :item="item"
                :conversationId="conversationId"
                @show-file="onShowFile"
            ></MessageContent>

            <MessageEditor v-else 
                class="rounded"
                :message="message_source"
                @cancel="updating = false"
                @update-message="onUpdateMessage"
            ></MessageEditor>

            <MessageEmoji :emojis="emojis"></MessageEmoji>
        </div>
        
        <MessageTools 
            :style="toolsStyle"
            :message="item"
            @selected-emoji="onSelectedEmoji"
            @delete-message="onDeleteMessage"
            @edit-message="onEditMessage"
        ></MessageTools>
    </div>
</template>

<script>
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import DateHelper from '~estarter/components/widgets/DateHelper.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'
    import MessageTools from './partials/MessageTools.vue'
    import MessageEmoji from './partials/MessageEmoji.vue'
    import MessageContent from '~socializer/components/Chat/widgets/partials/MessageContent.vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { useChatStore } from '~socializer/stores/chat.js'
    import { mapActions, mapState } from 'pinia'
    import { defineAsyncComponent } from '@vue/runtime-core'
    import { computePosition, offset, flip, shift } from '@floating-ui/dom'

    export default {
        name: "MessageWidget",
        inject: ["eventBus"],
        emits: [
            'selected-emoji',
            'delete-message',
            'update-message',
            'show-file',
        ],
        components: {
            Gravatar,
            DateHelper,
            UserWallLink,
            MessageTools,
            MessageEmoji,
            MessageContent,
            MessageEditor: defineAsyncComponent(() => import('./partials/MessageEditor.vue')),
        },
        props: {
            item: {
                type: Object,
                required: true,
            },
            conversationId: {
                type: [Number, String],
                required: true,
            },
            showTools: {
                type: Boolean,
                required: false,
                default: true,
            },
        },
        data() {
            return {
                toolsStyle: {},
                updating: false,
                message_source: null,
            }
        },
        watch: {
            updating: function() {
                if(this.updating) {
                    this.eventBus.$emit("disable-pointer-event", `chat-message-${this.item.id}`)
                }
                else {
                     this.eventBus.$emit("enable-pointer-event")
                }
            },
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
            ...mapActions(useChatStore, [
                'editMessage',
            ]),
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
            onDeleteMessage() {
                this.$emit('delete-message', this.item.id)
            },
            async onEditMessage() {
                this.message_source = await this.editMessage(this.item.id)
                this.updating = true
            },
            onUpdateMessage(message) {
                this.updating = false
                this.$emit('update-message', message, this.item.id)
            },
            onShowFile(fileUrl) {
                this.$emit('show-file', fileUrl)
            },
        },
    }
</script>