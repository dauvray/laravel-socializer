<template>
    <div v-if="currentServer" 
        :class="{ 'large' : breakpoints.up.lg , 'small' : breakpoints.down.lg }"
        id="server-wrapper">

        <!-- <ServerList 
            id="server-list"
            @change-server="onChangeServer"
        ></ServerList> -->

        <template v-if="breakpoints.up.lg">
            <section v-if="!isLoading" id="room-sidebar" 
                ref="sidebar"
                v-resizable="{
                    min: initialSidebarWidth,
                    max: 600,
                    callback: updateSidebarWidth
                }">
                <RoomSidebar
                    :currentServer="currentServer"
                    :serverUsers="serverUsers"
                    :rooms="rooms"
                    :key="roomParamsKey"
                    @create-room="onCreateRoom"
                    @delete-server="onDeleteServer"
                    @edit-server="onEditServer"
                    @add-module="onAddModule"
                    @delete-room="onDeleteRoom"
                    @edit-room="onEditRoom"
                    @sort-up-room="onSortUpRoom"
                    @sort-down-room="onSortDownRoom"
                ></RoomSidebar>
            </section>
        </template>
        <template v-else>
            <button id="offcanvasRoomSidebarBtn" type="button" data-bs-toggle="offcanvas" data-bs-target="#offcanvasRoomSidebar" aria-controls="offcanvasRoomSidebar">
                <IconWidget icon="bars"></IconWidget>Salons
            </button>
            <div class="offcanvas offcanvas-end" tabindex="-1" id="offcanvasRoomSidebar" aria-labelledby="offcanvasRoomSidebarLabel">
                <div class="offcanvas-header">
                    <h5 class="offcanvas-title" id="offcanvasRoomSidebarLabel">Offcanvas</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
                </div>
                <div class="offcanvas-body" id="room-sidebar" >
                    <RoomSidebar
                        :currentServer="currentServer"
                        :serverUsers="serverUsers"
                        :rooms="rooms"
                        :key="roomParamsKey"
                        @create-room="onCreateRoom"
                        @delete-server="onDeleteServer"
                        @edit-server="onEditServer"
                        @add-module="onAddModule"
                        @delete-room="onDeleteRoom"
                        @edit-room="onEditRoom"
                        @sort-up-room="onSortUpRoom"
                        @sort-down-room="onSortDownRoom"
                    ></RoomSidebar>
                </div>
            </div>
        </template>

        <RoomHeader 
            v-if="!isLoading" id="room-header" :style="setMainContentMargin">
            <template #tools>
                <div id="room-header-tools"></div>
            </template>
        </RoomHeader>

        <section v-if="!isLoading" id="main-room" :style="setMainContentMargin">
            <PageComponent
                v-if="showServerPage"
                :pageid="serverPage.id"
                :editable="isOwner"
            ></PageComponent>

            <router-view 
                :key="$route.params.roomId"
                @update-users-room="onUpdateRoomUsers"
            ></router-view>
        </section>

    </div>

    <SettingsModal    
        v-if="currentQuestionnaire"
        :questionnaireid="currentQuestionnaire"
        :isNew="isNewQuestionnaire"
        :modelPlaceholder="modelPlaceholder"
        :trigger="showModal"
        @hide-modal="onCancelEditModal"
        @send-data="onQuestionnaireData"
    ></SettingsModal>

</template>

<script setup>

    import { ref, computed, watch, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
    import { useRoute, useRouter } from 'vue-router'
    import { storeToRefs } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'
    import { usePeerStore } from '~socializer/stores/peers.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import RoomSidebar from './widgets/RoomSidebar.vue'
    import RoomHeader from './RoomHeader.vue'
  //  import ServerList from './widgets/ServerList.vue'
    import FormsSettingHelper from '~socializer/services/FormsSetting.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import vResizable from "~socializer/directives/resizable_vertical.js"
    import { useAjaxService } from '~estarter/services/AjaxService.js'
    import { useBreakpoints } from '~socializer/composables/useBreakpoints'
    import { useBreadcrumbService } from '~estarter/services/BreadcrumbService.js'
    import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

    const SettingsModal = defineAsyncComponent(() => import('~socializer/components/Server/widgets/SettingsModal.vue'))
    const PageComponent = defineAsyncComponent(() => import('~socializer/components/Page/PageComponent.vue'))

    defineOptions({ name: 'Server' })

    const emit = defineEmits([
        'update-users-server',
        'joining-user-server',
        'leaving-user-server',
    ])

    const AjaxService = useAjaxService()
    const breadcrumbService = useBreadcrumbService()
    const route = useRoute()
    const router = useRouter()
    const breakpoints = useBreakpoints()

    const serverStore = useServerStore()
    const peerStore = usePeerStore()
    const meStore = useMeStore()

    const { getIsStreaming: isStreaming, getIsCapturing: isCapturing } = storeToRefs(peerStore)
    const { getMe } = storeToRefs(meStore)
    const {
        getCurrentServer: currentServer,
        getCurrentRoom: currentRoom,
        getIsRoomStreamable: isRoomStreamable,
        getServerRooms: rooms,
        getOwnerId: ownerId,
        getServerPage: serverPage,
    } = storeToRefs(serverStore)

    const {
        loadServer,
        createRoom,
        createSubContent,
        resetServer,
        deleteUserServer,
        deleteRoom,
        removeRoom,
        resetCurrentRoom,
        addNewRoom,
        updateRoom,
        updateServer,
        sortDownRoom,
        sortUpRoom,
        addRoomModule,
    } = serverStore

    const initialSidebarWidth = 200
    const sidebarWidth = ref(null)
    const roomParamsKey = ref(0)
    const isLoading = ref(false)
    const showModal = ref(false)
    const canValidate = ref(false)
    const currentQuestionnaire = ref(null)
    const isNewQuestionnaire = ref(null)
    const modelPlaceholder = ref(null)
    const currentRoomUsers = ref([])

    const channelName = computed(() => {
        return currentServer.value ? `server.${currentServer.value.id}` : null
    })

    const meChannelName = computed(() => getMe.value?.channel ?? null)

    const showServerPage = computed(() => {
        return serverPage.value && route.name === 'server'
    })

    const currentRoomId = computed(() => {
        if(currentRoom.value) {
            return currentRoom.value.id
        }
        return null
    })

    const setMainContentMargin = computed(() => {
        let margin = 0

        if(sidebarWidth.value > initialSidebarWidth) {
            margin = sidebarWidth.value - initialSidebarWidth
        }

        return {
            width: `calc(100% - ${margin}px)`,
            marginLeft: `${margin}px`
        }
    })

    const isOwner = computed(() => {
        return ownerId.value === getMe.value.vertexid
    })

    function initLoadServer(serverId) {
        isLoading.value = true
        loadServer(serverId)
        .then( res => {
            if(!res) {
                router.push({ name: 'serverList'})
            }

            onUpdateBreadcrumb()
        })
    }

    function onChangeServer(serverId) {
        router.push({ name: 'server', params: { serverId: serverId }})
    }

    function onEditServer(server) {
        showModal.value = true
        isNewQuestionnaire.value = false
        modelPlaceholder.value = server
        currentQuestionnaire.value = FormsSettingHelper.questionnaires.createServer
    }

    function onDeleteServer(serverId) {
        deleteUserServer(serverId)
        .then( () => {
            router.push({ name: 'serverList'})
        })
    }

    function onCreateRoom() {
        showModal.value = true
        isNewQuestionnaire.value = true
        modelPlaceholder.value = null
        currentQuestionnaire.value = FormsSettingHelper.questionnaires.createServerRoom
    }

    function onEditRoom(room) {
        showModal.value = true
        isNewQuestionnaire.value = false
        modelPlaceholder.value = room
        currentQuestionnaire.value = FormsSettingHelper.questionnaires.createServerRoom
    }

    function onDeleteRoom(roomId) {
        deleteRoom(roomId)
        .then(() => {
            kickFromRoom(roomId)
        })
    }

    function kickFromRoom(roomId) {
        if(currentRoom.value && currentRoom.value.id === roomId) {
            router.push({ name: 'server', params: { serverId: currentServer.value.id } })
        }
    }

    function onCancelEditModal() {
        showModal.value = false
        currentQuestionnaire.value = null
    }

    function onQuestionnaireData(formData) {
        canValidate.value = false

        // create room serve
        if(currentQuestionnaire.value === FormsSettingHelper.questionnaires.createServerRoom) {

            if(isNewQuestionnaire.value) {
                createRoom({
                    room: formData.get('model'),
                    serverId: currentServer.value.id
                })
            // update room
            } else {
                updateRoom(formData)
            }

        }

        // update server
        if(currentQuestionnaire.value === FormsSettingHelper.questionnaires.createServer) {
            updateServer(formData)
        }

        // add room module
        if(currentQuestionnaire.value === FormsSettingHelper.questionnaires.createRoomModule) {
            addRoomModule(formData)
        }
    }

    function onUpdateRoomUsers(users) {
        currentRoomUsers.value = [...users]
    }

    function onSortUpRoom(index) {
        sortUpRoom(index)
        roomParamsKey.value++
    }

    function onSortDownRoom(index) {
        sortDownRoom(index)
        roomParamsKey.value++
    }

    function onAddModule() {
        showModal.value = true
        isNewQuestionnaire.value = true
        modelPlaceholder.value = null
        currentQuestionnaire.value = FormsSettingHelper.questionnaires.createRoomModule
    }

    function updateSidebarWidth(newWidth) {
        sidebarWidth.value = newWidth
    }

    function onUpdateBreadcrumb() {
        breadcrumbService.updateBreadcrumb({
            name: currentServer.value.name,
            id: 'server_name',
            link: { name: 'server', params: { serverId: currentServer.value.id } },
            internal: true
        })
    }

    initLoadServer(route.params.serverId)

    onMounted(() => {
        sidebarWidth.value = initialSidebarWidth
    })

    // S'exécute avant les leave() auto enregistrés par les useReverbChannel ci-dessous.
    onBeforeUnmount(() => {
        whisperMe('leave-server', {
            userId: getMe.value.id,
            serverId: currentServer.value.id,
        })
        resetServer()
    })

    const { whisper: whisperMe } = useReverbChannel(meChannelName, {
        type: 'private',
    })

    const { users: serverUsers } = useReverbChannel(channelName, {
        type: 'presence',
        listeners: {
            '.roomCreated': (event) => {
                if(!rooms.value.some(item => item.id === event.id)) {
                    addNewRoom(event)
                }
            },
            '.subRoomCreated': (event) => {
                if(currentRoom.value.id === event.parent_id) {
                    createSubContent(event, true)
                }
            },
            '.roomUpdated': (event) => {
                if(rooms.value.some(item => item.id === event.room.id)) {
                    updateRoom(event.room, true)
                }
            },
            '.roomDeleted': (event) => {
                if(rooms.value.some(item => item.id === event.room_id)) {
                    deleteRoom(event.room_id, true)
                    kickFromRoom(event.room_id)
                }
            },
            '.serverUpdated': (event) => {
                if(currentServer.value.id === event.server.id) {
                    updateServer(event.server, true)
                }
            },
        },
        onJoining: (user) => emit('joining-user-server', user),
        onLeaving: (user) => emit('leaving-user-server', user),
        onError: (err) => console.error(err),
    })

    watch(serverUsers, (users) => {
        emit('update-users-server', users)
    })

    watch(currentServer, (value) => {
        if(value) {
            isLoading.value = false
        }
    })

    watch(route, (to, from) => {
        if( to.params.hasOwnProperty('serverId') && to.params.serverId != from.params.serverId ) {
            initLoadServer(to.params.serverId)
        }
        onUpdateBreadcrumb()
    })
</script>