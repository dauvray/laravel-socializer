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

<script>
    import { mapActions, mapState } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { defineAsyncComponent } from '@vue/runtime-core'
    import { useBreadcrumbService } from '~estarter/services/BreadcrumbService.js'
    const breadcrumbService = useBreadcrumbService()
    import ChatComponent from '~socializer/components/Chat/ChatComponent.vue'
    import { useChatStore } from '~socializer/stores/chat.js'
    import resizable from "~socializer/directives/resizable_vertical.js";

    export default {
        name: 'Room',
        emits: [
            'update-users-room',
            'joining-user-room',
            'leaving-user-room',
        ],
        components: {
            LockedRoom: defineAsyncComponent(() => import('./widgets/LockedRoom.vue')),
            ChatComponent,
        },
        directives: {
            resizable,
        },
        data() {
            return {
                users: [],
                roomLocked: false,
                chatWidth: 420,
                isChatVisible: false,
            }
        },
        async created() {
            await this.loadRoom(this.$route.params.roomId)
            this.loadDefaultContent()
        },
        beforeUnmount() {
            Echo.leave(this.channel)
            Echo.private(this.getMe.channel).whisper('leave-room', {
                userId: this.getMe.id,
                roomId: this.currentRoom.id,
            })

            this.resetCurrentRoom()
        },
        computed: {
            ...mapState(useServerStore, {
                currentRoom: 'getCurrentRoom',
                ownerId: 'getOwnerId',
                roomContent: 'getCurrentRoomContent',
                roomChatVisible: 'getRoomChatVisible',
            }),
            ...mapState(useChatStore, {
                currentConversationId: 'getCurrentConversationId',
            }),
            ...mapState(useMeStore, {
                getMe: 'getMe',
            }),
            channel: function() {
                if(this.currentRoom) {
                    return `room.${this.currentRoom.id}`
                }
                return null
            },
            isOwner: function() {
                return this.ownerId === this.getMe.vertexid
            }
        },
        watch: {
            '$route' (to, from ) {
                // is stay on same server
                if(to.params.hasOwnProperty('serverId') && to.params.serverId === from.params.serverId 
                        && !to.params.hasOwnProperty('vertexId')){
                  this.loadDefaultContent()
                }
                this.onUpdateBreadcrumb()
            },
            channel(newVal, oldVal) {
                if(oldVal) {
                    Echo.leave(oldVal)
                }
                if(newVal) {

                    // voir si utile ( room dans les composants)
                    this.initRoomEvents()
                }
            },
            currentRoom(newRoom) {
                this.resetRoomUsers()

                if(newRoom && newRoom.hasOwnProperty('content_type') && newRoom.content_type === "locked") {
                    this.roomLocked = true
                }
            }
        },
        methods: {
            ...mapActions(useServerStore, [
                'loadRoom',
                'resetCurrentRoom',
            ]),
            initRoomEvents() {
                if(this.channel) {
                    Echo.leave(this.channel)
                    Echo.join(this.channel)
                        .here((users) => {
                            this.users = users
                            this.$emit('update-users-room', this.users)
                        })
                        .joining((user) => {
                            this.users.push(user)
                            this.$emit('joining-user-room', user)
                            this.$emit('update-users-room', this.users)
                        })
                        .leaving((user) => {
                            this.users = this.users.filter( item => {
                                return user.id != item.id
                            })
                            this.$emit('leaving-user-room', user)
                            this.$emit('update-users-room', this.users)
                        })
                        .error((error) => {
                            console.error(error);
                        })
                }
            },
            loadDefaultContent() {
                if(this.currentRoom.hasOwnProperty('content')) {
                    const defaultContent = this.currentRoom.content[0]
                    this.$router.push({ name: defaultContent.content_type, params: { vertexId: defaultContent.id } })
                }
                this.onUpdateBreadcrumb()
            },
            resetRoomUsers() {
                this.users = []
                this.$emit('update-users-room', this.users)
            },
            onUpdateBreadcrumb() {
                breadcrumbService.updateBreadcrumb({
                    name: this.currentRoom.name,
                    id: 'content',
                    link: null,
                })
            },
            updateChatWidth(newWidth) {
                this.chatWidth = newWidth
            },

        },
    }
</script>