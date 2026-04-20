<template>
    <Teleport to="#room-header-tools">
        <button type="button" class="btn btn-primary btn-sm" @click="onToggleChat">
            <IconWidget icon="comments"></IconWidget>
        </button>
    </Teleport>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { useServerStore } from '~socializer/stores/server.js'
    import { useChatStore } from '~socializer/stores/chat.js'
    import { mapActions, mapState } from 'pinia'

    export default {
        name: 'ChatCreatorButton',
        components: {
            IconWidget,
        },
        data() {
            return {
                loaded: false,
            }
        },
         computed: {
            ...mapState(useServerStore, {
                currentRoomId: 'getCurrentRoomId',
                roomChatVisible: 'getRoomChatVisible',
            }),
        },
        computed: {
            ...mapState(useServerStore, {
                currentRoomId: 'getCurrentRoomId',
                roomChatVisible: 'getRoomChatVisible',
            }),
        },
        methods: {
            ...mapActions(useChatStore, [
                'getOrCreateRoomConversation',
            ]),
            ...mapActions(useServerStore, [
                'setRoomChatVisible',
            ]),
            onToggleChat() {
                if(!this.loaded) {
                    const roomId = this.currentRoomId ? this.currentRoomId : null
                    if(roomId && !this.roomChatVisible) {
                        this.getOrCreateRoomConversation(roomId)
                        this.setRoomChatVisible(true)
                        this.loaded = true
                    }
                } else {
                    this.setRoomChatVisible(!this.roomChatVisible)
                }
            },
        }
    }
</script>