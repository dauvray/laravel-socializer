<template>
    <div v-if="currentServer" id="server-wrapper">

        <!-- <ServerList 
            id="server-list"
            @change-server="onChangeServer"
        ></ServerList> -->

        <section v-if="!isLoading" id="room-sidebar" 
            ref="sidebar"
            v-resizable="{
                min: initialSidebarWidth,
                max: 600,
                callback: updateSidebarWidth
            }">
          
            <ServerParamsButton
                id="room-params"
                :server="currentServer"
                :serverUsersTotal="serverUsers.length"
                @create-room="onCreateRoom"
                @delete-server="onDeleteServer"
                @edit-server="onEditServer"
                @add-module="onAddModule"
            ></ServerParamsButton>

            <RoomParamsWrapper
                id="room-list"
                :key="roomParamsKey"
                :currentServer="currentServer"
                :rooms="rooms"
                @delete-room="onDeleteRoom"
                @edit-room="onEditRoom"
                @sort-up-room="onSortUpRoom"
                @sort-down-room="onSortDownRoom"
            ></RoomParamsWrapper>
            
        </section>
          
        <section v-if="!isLoading" id="room-header" :style="setMainContentMargin">
            <RoomHeader id="room-header-inner"></RoomHeader>
            <div id="room-stream-btn" role="group">
            <StreamUserButton 
                    v-if="showStreamButton"
                    ref="webcamBtn"
                    :users="currentRoomUsers"
                    :room="currentRoomId"
                    @started-stream="onStartedStream"
                    @stoped-stream="onStopedStream"
                ></StreamUserButton>
                <CaptureUserButton
                    v-if="showCaptureButton"
                    ref="screenBtn"
                    :users="currentRoomUsers"
                    :room="currentRoomId"
                    @started-stream="onStartedStream"
                    @stoped-stream="onStopedStream"
                ></CaptureUserButton>
            </div>
        </section>

        <section v-if="!isLoading" id="main-room" :style="setMainContentMargin">
            <PageComponent
                v-if="showServerPage"
                :pageid="serverPage.id"
                :editable="isOwner"
                :isServerHome="showServerPage"
            ></PageComponent>

            <router-view 
            :key="$route.params.roomId"
                @update-users-room="onUpdateRoomUsers"
            ></router-view>
        </section>

    </div>

    <SettingsModal    
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
    import ServerParamsButton from './widgets/ServerParamsButton.vue'
    import RoomHeader from './RoomHeader.vue'
  //  import ServerList from './widgets/ServerList.vue'
    import FormsSettingHelper from '~socializer/services/FormsSetting.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import StreamUserButton from '~socializer/components/WebRTC/widgets/StreamUserButton.vue'
    import CaptureUserButton from '~socializer/components/WebRTC/widgets/CaptureUserButton.vue'
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import RoomParamsWrapper from './widgets/RoomParamsWrapper.vue'
    import resizable from "~socializer/directives/resizable_vertical.js"


    import { useAjaxService } from '~estarter/services/AjaxService.js'
    const AjaxService = useAjaxService()

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
            ServerParamsButton,
            RoomParamsWrapper,
            RoomHeader,
         //   ServerList,
            IconWidget,
            SettingsModal: defineAsyncComponent(() => import('~socializer/components/Server/widgets/SettingsModal.vue')),
            PageComponent: defineAsyncComponent(() => import('~socializer/components/Page/PageComponent.vue')),
            StreamUserButton,
            CaptureUserButton,
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
            }
        },
        computed: {
            ...mapState(usePeerStore, {
                isStreaming: 'getIsStreaming',
                isCapturing: 'getIsCapturing',
            }),
            ...mapState(useServerStore, {
                currentServer: 'getCurrentServer',
                currentRoom: 'getCurrentRoom',
                isRoomStreamable: 'getIsRoomStreamable',
                rooms: 'getServerRooms',
                isOwner: 'isOwner',
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
            showStreamButton: function() {
                return this.isRoomStreamable || this.isStreaming
            },
            showCaptureButton: function() {
                return this.isRoomStreamable || this.isCapturing
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
            }
        },
        created() {
            this.initLoadServer(this.$route.params.serverId)
        },
        mounted() {
            this.sidebarWidth = this.initialSidebarWidth
        },
        unmounted() {
            Echo.leave(this.channel)
            this.resetServer()
        },
        watch: {
            '$route' (to, from) {
                if( to.params.hasOwnProperty('serverId') && to.params.serverId != from.params.serverId ) {
                    this.initLoadServer(to.params.serverId)
                }
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
                this.currentRoomUsers = users
            },
            onStartedStream(source) {
                const roomWrapper = document.querySelector('#main-room')
                
                if(source == 'stream') {
                    if(!roomWrapper.classList.contains('stream-video')) {
                        roomWrapper.classList.add('stream-video')
                    }
                }

                if(source == 'screen') {
                    if(!roomWrapper.classList.contains('screen-capture')) {
                        roomWrapper.classList.add('screen-capture')
                    }
                }
            },
            onStopedStream(source) {
                const roomWrapper = document.querySelector('#main-room')
                const videoWrapper = document.querySelector('#videoContainer')

                switch(source) {
                    case 'stream':
                        roomWrapper.classList.remove('stream-video')
                        break
                    case 'screen':
                        roomWrapper.classList.remove('screen-capture')
                        break
                }

                if(!videoWrapper.hasChildNodes()) {
                    roomWrapper.classList.remove('stream-video','screen-capture')
                }    
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
        }
    }
</script>