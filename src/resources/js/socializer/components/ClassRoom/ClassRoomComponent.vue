<template>
    <div class="classroom-wrapper">
        <RoomUsersList :users="users" class="ms-3 mt-2 mb-2"></RoomUsersList>
        <div class="classroom">
             <ChatComponent
                v-if="chatId && showChat"
                ref="chat"
                v-resizable="{
                    min: 400,
                    max: 800,
                    callback: updateChatWidth
                }"
                :vertexId="chatId"
                :displayHeader="false"
            ></ChatComponent>
           <WhiteboardComponent
                v-if="showWhiteboard && whiteboardRoom"
                ref="whiteboard"
                :room="whiteboardRoom"
                :users="users"
                :displayCollaborators="false"
            ></WhiteboardComponent>
        </div>
    </div>
    <Teleport :to="`#collapser-${room.id}`" >
        <ConfigPanel 
            v-if="editable"
            :whiteBoard="showWhiteboard"
            :chat="showChat"
            @show-whiteboard="handleShowWhiteboard"
            @show-chat="handleShowChat"
        ></ConfigPanel>
    </Teleport>
    <DataUserPeerConnection 
        v-if="users && room.id"
        :users="users"
        :roomId="room.id"
        :callback-connection="connectionDataCallback"
    ></DataUserPeerConnection>
</template>

<script>

    import ChatComponent from  '~socializer/components/Chat/ChatComponent.vue'
    import WhiteboardComponent from '~socializer/components/Whiteboard/WhiteboardComponent.vue'
    import DataUserPeerConnection from '~socializer/components/WebRTC/widgets/DataUserPeerConnection.vue'
    import RoomUsersList from '~socializer/components/Server/widgets/RoomUsersList.vue'
    import ConfigPanel from './ConfigPanel.vue'
    import { mapActions, mapState } from 'pinia'
    import { usePeerStore } from '~socializer/stores/peers.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import resizable from "~socializer/directives/resizable_vertical.js";

    export default {
        name: 'ClassRoomComponent',
        props: {
            users: {
                type: Array,
                required: true,
            },
            room: {
                type: Object,
                required: true,
            },
            editable: {
                type: Boolean,
                required: false,
                default: false,
            }
        },
        components: {
            ChatComponent,
            WhiteboardComponent,
            RoomUsersList,
            ConfigPanel,
            DataUserPeerConnection,
        },
        directives: {
            resizable,
        },
        data() {
            return {
                showWhiteboard: true,
                showChat: true,
                chatWidth : null,
            }
        },
        mounted() {
            setTimeout(() => {
                this.chatWidth = this.$refs.chat.$el.getBoundingClientRect().left
            }, 1000)
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            chatId: function() {
                let chat_id = null
                if(this.room.hasOwnProperty('subcontent')) {
                    this.room.subcontent.forEach(subcontent => {
                        if(subcontent.content_type === 'chat') {
                            chat_id = subcontent.id
                        }
                    })
                }

                return chat_id
            },
            whiteboardRoom: function() {
                let whiteboard_room = null
               
                if(this.room.hasOwnProperty('subcontent')) {
                    this.room.subcontent.forEach(subcontent => {
                        if(subcontent.content_type === 'whiteboard') {
                            whiteboard_room = subcontent
                        }
                    })
                }
                return whiteboard_room 
            },
        },
        watch: {
            chatId(newChatId) {
                if (newChatId && this.$refs.chat) {
                   // console.log(this.$refs.chat.$el)
                }
            },
        },
        methods: {
            ...mapActions(usePeerStore, [
                'sendData',
            ]),
            updateChatWidth(newWidth) {
                this.chatWidth = newWidth;
            },
            /*------  DATA CONNECTION ----------*/
            connectionDataCallback(conn) {
                console.log('nouvelle connexion data classroom', conn.connectionId)
                conn.on("data", (data) => {
                    data = JSON.parse(data)
                    switch(data.action) {
                        case 'whiteboard-toggle':
                            this.showWhiteboard = data.value
                          break
                        case 'chat-toggle':
                            this.showChat = data.value
                          break
                    }
                });
                conn.on("open", () => {
                    console.log('connection data classroom ouverte')
                });
                conn.on("close", () => {
                    console.log('connection data classroom fermée')
                });
            },
            handleShowWhiteboard(value) {
                this.showWhiteboard = value
                this.sendData({
                    data: {
                        action: 'whiteboard-toggle',
                        from: this.me.name,
                        value: value,
                    }
                }, this.room.id)
            },
            handleShowChat(value) {
                this.showChat = value
                this.sendData({
                    data: {
                        action: 'chat-toggle',
                        from: this.me.name,
                        value: value,
                    }
                }, this.room.id)
            }
        }
    }
</script>

<style lang="scss">
    .classroom-wrapper {
        height: 100%;

        .classroom {
            display: flex;
            height: 90%;
        }
    }
</style>