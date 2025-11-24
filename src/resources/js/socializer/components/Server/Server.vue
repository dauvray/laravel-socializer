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

<script>

    import { defineAsyncComponent } from '@vue/runtime-core'
    import { mapActions, mapState } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'
    import { usePeerStore } from '~socializer/stores/peers.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import RoomSidebar from './widgets/RoomSidebar.vue'
    import RoomHeader from './RoomHeader.vue'
  //  import ServerList from './widgets/ServerList.vue'
    import FormsSettingHelper from '~socializer/services/FormsSetting.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import resizable from "~socializer/directives/resizable_vertical.js"
    import { useAjaxService } from '~estarter/services/AjaxService.js'
    import { useBreakpoints } from '~socializer/composables/useBreakpoints'
    const AjaxService = useAjaxService()
    import { useBreadcrumbService } from '~estarter/services/BreadcrumbService.js'
    const breadcrumbService = useBreadcrumbService()

    export default {
        name: 'Server',
        emits: [
            'update-users-server',
            'joining-user-server',
            'leaving-user-server',
        ],
        directives: {
            resizable,
        },
        components: {
            RoomSidebar,
            RoomHeader,
         //   ServerList,
            IconWidget,
            SettingsModal: defineAsyncComponent(() => import('~socializer/components/Server/widgets/SettingsModal.vue')),
            PageComponent: defineAsyncComponent(() => import('~socializer/components/Page/PageComponent.vue')),
            Gravatar,
        },
        data() {
            return {
                initialSidebarWidth: 200,
                sidebarWidth : null,
                roomParamsKey: 0,
                isLoading: false,
                showModal: false,
                canValidate: false,
                currentQuestionnaire: null,
                isNewQuestionnaire: null,
                modelPlaceholder: null,
                currentRoomUsers: [],
                serverUsers: [],
                breakpoints: useBreakpoints(),
            }
        },
        computed: {
            ...mapState(usePeerStore, {
                isStreaming: 'getIsStreaming',
                isCapturing: 'getIsCapturing',
            }),
            ...mapState(useMeStore, {
                getMe: 'getMe',
            }),
            ...mapState(useServerStore, {
                currentServer: 'getCurrentServer',
                currentRoom: 'getCurrentRoom',
                isRoomStreamable: 'getIsRoomStreamable',
                rooms: 'getServerRooms',
                ownerId: 'getOwnerId',
                serverPage: 'getServerPage',
            }),
            channel: function() {
                if(this.currentServer) {
                    return `server.${this.currentServer.id}`
                }
                return null
            },
            showServerPage: function() {
                return this.serverPage && this.$route.name === 'server'
            },
            currentRoomId: function() {
                if(this.currentRoom) {
                    return this.currentRoom.id
                }
                return null
            },
            setMainContentMargin: function() {
                let margin = 0

                if(this.sidebarWidth > this.initialSidebarWidth) {
                    margin = this.sidebarWidth - this.initialSidebarWidth
                }

                return { 
                    width: `calc(100% - ${margin}px)`, 
                    marginLeft: `${margin}px` 
                }
            },
            isOwner: function() {
                return this.ownerId === this.getMe.vertexid
            },
        },
        created() {
            this.initLoadServer(this.$route.params.serverId)
        },
        mounted() {
            this.sidebarWidth = this.initialSidebarWidth
        },
        beforeUnmount() {
            Echo.leave(this.channel)
            Echo.private(this.getMe.channel).whisper('leave-server', {
                userId: this.getMe.id,
                serverId: this.currentServer.id,
            })
            this.resetServer()
        },
        watch: {
            '$route' (to, from) {
                if( to.params.hasOwnProperty('serverId') && to.params.serverId != from.params.serverId ) {
                    this.initLoadServer(to.params.serverId)
                }
                this.onUpdateBreadcrumb()
            },
            currentServer(value) {
                if(value) {
                    this.iniServerEvents()
                }
            }
        },
        methods: {
            ...mapActions(useServerStore, [
                'loadServer',
                'createRoom',
                'createSubContent',
                'resetServer',
                'deleteServer',
                'deleteRoom',
                'removeRoom',
                'resetCurrentRoom',
                'addNewRoom',
                'updateRoom',
                'updateServer',
                'sortDownRoom',
                'sortUpRoom',
                'addRoomModule',
            ]),
            initLoadServer(serverId) {
                this.isLoading = true
                this.loadServer(serverId)
                .then( res => {
                    if(!res) {
                        this.$router.push({ name: 'serverList'})
                    }

                    this.onUpdateBreadcrumb()
                }) 
            },
            onChangeServer(serverId) {
                this.$router.push({ name: 'server', params: { serverId: serverId }})
            },
            async iniServerEvents() {
                if(this.channel) {
                    Echo.leave(this.channel)
                    Echo.join(this.channel)
                        .here((users) => {
                            this.serverUsers = users
                            this.$emit('update-users-server', this.users)
                        })
                        .joining((user) => {
                            this.serverUsers.push(user)
                            this.$emit('joining-user-server', user)
                            this.$emit('update-users-server', this.serverUsers)
                        })
                        .leaving((user) => {
                            this.serverUsers = this.serverUsers.filter( item => {
                                return user.id != item.id
                            })
                            this.$emit('leaving-user-server', user)
                            this.$emit('update-users-server', this.serverUsers)
                        })
                        .listen('.roomCreated', (event) => {
                            if(!this.rooms.some(item => item.id === event.id)) {
                                this.addNewRoom(event)
                            }
                        })
                        .listen('.subRoomCreated', (event) => {
                            if(this.currentRoom.id === event.parent_id) {
                                this.createSubContent(event, true)
                            }
                        })
                        .listen('.roomUpdated', (event) => {
                            if(this.rooms.some(item => item.id === event.room.id)) {
                                this.updateRoom(event.room, true)
                            }
                        })
                        .listen('.roomDeleted', (event) => {
                            if(this.rooms.some(item => item.id === event.room_id)) {
                                this.deleteRoom(event.room_id, true)
                                this.kickFromRoom(event.room_id)
                            }
                        })
                        .listen('.serverUpdated', (event) => {
                            if(this.currentServer.id === event.server.id) {
                                this.updateServer(event.server, true)
                            }
                        })
                        .error((error) => {
                            console.error(error);
                        })

                        this.isLoading = false
                }
            },
            onEditServer(server) {
                this.showModal = true
                this.isNewQuestionnaire = false
                this.modelPlaceholder = server
                this.currentQuestionnaire = FormsSettingHelper.questionnaires.createServer
            },
            onDeleteServer(serverId) {
               this.deleteServer(serverId)
               .then( () => {
                    this.$router.push({ name: 'serverList'})
               })
            },
            onCreateRoom() {
                this.showModal = true
                this.isNewQuestionnaire = true
                this.modelPlaceholder = null
                this.currentQuestionnaire = FormsSettingHelper.questionnaires.createServerRoom
            },
            onEditRoom(room) {
                this.showModal = true
                this.isNewQuestionnaire = false
                this.modelPlaceholder = room
                this.currentQuestionnaire = FormsSettingHelper.questionnaires.createServerRoom
            },
            onDeleteRoom(roomId) {
                this.deleteRoom(roomId)
                .then(() => {
                    this.kickFromRoom(roomId)
                })
            },
            kickFromRoom(roomId) {
                if(this.currentRoom && this.currentRoom.id === roomId) {
                    this.resetCurrentRoom()
                    this.$router.push({ name: 'server', params: { serverId: this.currentServer.id } })
                }
            },
            onCancelEditModal() {
                this.showModal = false
                this.currentQuestionnaire = null
            },
            onQuestionnaireData(formData){
                this.canValidate = false
                
                // create room serve
                if(this.currentQuestionnaire === FormsSettingHelper.questionnaires.createServerRoom) {
                    
                    if(this.isNewQuestionnaire) {
                        this.createRoom({
                            room: formData.get('model'),
                            serverId: this.currentServer.id
                        })
                    // update room 
                    } else {
                        this.updateRoom(formData)
                    }

                } 

                // update server
                if(this.currentQuestionnaire === FormsSettingHelper.questionnaires.createServer) {
                    this.updateServer(formData)
                }

                // add room module
                if(this.currentQuestionnaire === FormsSettingHelper.questionnaires.createRoomModule) {
                    this.addRoomModule(formData)
                }
            },
            onUpdateRoomUsers(users) {
                this.currentRoomUsers = [...users]
            },
            onSortUpRoom(index) {
                this.sortUpRoom(index)
                this.roomParamsKey++
            },
            onSortDownRoom(index) {
                this.sortDownRoom(index)
                this.roomParamsKey++
            },
            onAddModule() {
                this.showModal = true
                this.isNewQuestionnaire = true
                this.modelPlaceholder = null
                this.currentQuestionnaire = FormsSettingHelper.questionnaires.createRoomModule
            },
            updateSidebarWidth(newWidth){
                this.sidebarWidth = newWidth;
            },
            onUpdateBreadcrumb() {
                breadcrumbService.updateBreadcrumb({
                    name: this.currentServer.name,
                    id: 'server_name',
                    link: { name: 'server', params: { serverId: this.currentServer.id } },
                    internal: true
                })
            },
        }
    }
</script>