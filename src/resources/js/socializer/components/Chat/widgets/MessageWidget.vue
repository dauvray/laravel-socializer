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

            <div v-if="!updating" 
                class="message-inner" 
                :class="{'is-me': isMe }">
                <div v-if="hasFiles" class="files">
                    <JoinedFiles 
                        v-for="(file, idx) in item.extras.files" 
                        :key="idx"
                        :file="file"
                        :conversationId="conversationId"
                    ></JoinedFiles>
                </div>
                <AudioPlayer v-if="isAudio" :src="`/chat/file/${conversationId}/${item.extras.audio.filename}`"></AudioPlayer>
                <div v-if="hasMessage" class="message" v-html="item.message"></div>
                <small v-if="isEdited" class="ps-2"><i>Modifié</i></small>
            </div>

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
            :is-editable="!isAudio"
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
        ],
        components: {
            Gravatar,
            DateHelper,
            UserWallLink,
            MessageTools,
            MessageEmoji,
            MessageEditor: defineAsyncComponent(() => import('./partials/MessageEditor.vue')),
            AudioPlayer: defineAsyncComponent(() => import('~estarter/components/widgets/AudioPlayer.vue')),
            JoinedFiles: defineAsyncComponent(() => import('./partials/JoinedFiles.vue')),
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
            isEdited:function() {
                if(!this.item.hasOwnProperty('extras')) return false
                if(!this.item.extras.hasOwnProperty('edited')) return false
                return this.item.extras.edited === 1
            },
            isAudio: function() {
                if(!this.item.hasOwnProperty('extras')) return false
                return this.item.extras.hasOwnProperty('audio') && this.item.extras.audio !== null
            },
            hasFiles: function() {
                if(!this.item.hasOwnProperty('extras')) return false
                return this.item.extras.hasOwnProperty('files') && this.item.extras.files
            },
            hasMessage: function() {
                return this.item.hasOwnProperty('message') && this.item.message
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
            }
        },
    }
</script>