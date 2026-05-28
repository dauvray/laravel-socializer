<template>
    <div v-if="currentRoom"
        class="room-wrapper">
        <div id="room-navigation"></div>

        <!-- une room peut contenir plusieurs pages donc ici navigation 
         mais l'ajout d'un chat dans chaque room à changé la donne 
         ( TODO : a refacto et a déplacer ailleurs ) -->
        <!-- <Teleport :to="`#collapser-${currentRoom.id}`" >
            <ul class="list-group list-group-flush">
                <li class="list-group-item" v-for="(content, index) in roomContent"  >
                    <router-link 
                        :to="{ name: content.content_type, params: { vertexId: content.id }}" 
                        class="room-name">
                        <button  type="button">{{ content.name }}</button>
                    </router-link>
                </li>
            </ul>
        </Teleport> -->

        <div class="room-content-layout">
            <div class="room-content-main">
                <router-view
                    v-if="!roomLocked"
                    :editable="isOwner"
                    :users="users"
                    :room="currentRoom"
                ></router-view>
                <LockedRoom v-else></LockedRoom>
            </div>

            <ChatComponent
                v-if="roomChatVisible"
                ref="chat"
                class="room-chat"
                :style="{ width: `${chatWidth}px` }"
                v-resizable="{
                    min: 400,
                    max: 800,
                    handle: 'left',
                    callback: updateChatWidth
                }"
                :vertexId="currentConversationId"
                :displayUsers="false"
                :autoload="false"
            ></ChatComponent>
        </div>


    </div>
</template>

<script setup>
    // VUE & LIBS
    import { ref, computed, watch, onBeforeUnmount, defineAsyncComponent } from 'vue'
    import { storeToRefs } from 'pinia'
    import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router'

    // STORES
    import { useServerStore } from '~socializer/stores/server.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { useChatStore } from '~socializer/stores/chat.js'

    // COMPOSABLES
    import { useBreadcrumbService } from '~estarter/services/BreadcrumbService.js'
    import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

    // UTILS & DIRECTIVES
    import vResizable from '~socializer/directives/resizable_vertical.js'

    // COMPOSANTS ASYNCHRONES
    const LockedRoom = defineAsyncComponent(() => import('./widgets/LockedRoom.vue'))
    const ChatComponent = defineAsyncComponent(() => import('~socializer/components/Chat/ChatComponent.vue'))

    const emit = defineEmits([
        'update-users-room',
        'joining-user-room',
        'leaving-user-room',
    ])

    const route = useRoute()
    const router = useRouter()
    const breadcrumbService = useBreadcrumbService()

    const serverStore = useServerStore()
    const chatStore = useChatStore()
    const meStore = useMeStore()

    const {
        getCurrentRoom: currentRoom,
        getOwnerId: ownerId,
        // utilisé par le <Teleport> commenté du template — à réactiver avec la navigation multi-pages d'une room
        getCurrentRoomContent: roomContent,
        getRoomChatVisible: roomChatVisible,
    } = storeToRefs(serverStore)
    const { getCurrentConversationId: currentConversationId } = storeToRefs(chatStore)
    const { getMe } = storeToRefs(meStore)
    const { loadRoom, resetCurrentRoom } = serverStore

    const roomLocked = ref(false)
    const chatWidth = ref(420)
    const isChatVisible = ref(false)
    const chat = ref(null)

    const channelName = computed(() => {
        if (currentRoom.value) {
            return `room.${currentRoom.value.id}`
        }
        return null
    })

    const meChannelName = computed(() => getMe.value?.channel ?? null)

    const isOwner = computed(() => ownerId.value === getMe.value.vertexid)

    const onUpdateBreadcrumb = () => {
        breadcrumbService.updateBreadcrumb({
            name: currentRoom.value.name,
            id: 'content',
            link: null,
        })
    }

    const loadDefaultContent = () => {
        if (currentRoom.value.hasOwnProperty('content')) {
            const defaultContent = currentRoom.value.content[0]
            router.push({ name: defaultContent.content_type, params: { vertexId: defaultContent.id } })
        }
        onUpdateBreadcrumb()
    }

    const updateChatWidth = (newWidth) => {
        chatWidth.value = newWidth
    }

    watch(currentRoom, (newRoom) => {
        if (newRoom && newRoom.hasOwnProperty('content_type') && newRoom.content_type === 'locked') {
            roomLocked.value = true
        }
    })

    onBeforeRouteUpdate((to, from) => {
        // is stay on same server
        if (to.params.hasOwnProperty('serverId') && to.params.serverId === from.params.serverId
                && !to.params.hasOwnProperty('vertexId')) {
            loadDefaultContent()
        }
        onUpdateBreadcrumb()
    })

    // S'exécute avant les leave() auto enregistrés par les useReverbChannel ci-dessous.
    onBeforeUnmount(() => {
        whisperMe('leave-room', {
            userId: getMe.value.id,
            roomId: currentRoom.value.id,
        })
        resetCurrentRoom()
    })

    const { whisper: whisperMe } = useReverbChannel(meChannelName, {
        type: 'private',
    })

    const { users } = useReverbChannel(channelName, {
        type: 'presence',
        onJoining: (user) => emit('joining-user-room', user),
        onLeaving: (user) => emit('leaving-user-room', user),
        onError: (err) => console.error(err),
    })

    watch(users, (val) => {
        emit('update-users-room', val)
    })

    const initRoom = async () => {
        await loadRoom(route.params.roomId)
        loadDefaultContent()
    }
    initRoom()
</script>