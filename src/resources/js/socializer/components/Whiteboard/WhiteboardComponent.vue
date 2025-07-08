<template>
    <RoomUsersList v-if="displayCollaborators" :users="users"></RoomUsersList>

      <!-- <input type="file" @change="handleFileUpload" accept=".excalidrawlib" /> -->

     <div class="whiteboard">
        <excalidraw-element ref="excalidrawElement"></excalidraw-element>
        <div v-for="(pointer, id) in pointers" :key="id" 
            class="pointer" 
            :style="{ left: pointer.x + 'px', top: pointer.y + 'px' }">
          👆 <span class="badge text-bg-light">{{ id }}</span>
        </div>
    </div>

    <DataUserPeerConnection 
        v-if="users && whiteBoardId"
        :users="users"
        :roomId="whiteBoardId"
        :callback-connection="connectionDataCallback"
    ></DataUserPeerConnection>
</template>
  
  <script>
  
    import { defineAsyncComponent } from '@vue/runtime-core'
    import "./ExcalidrawElement.jsx"; // Import du Web Component
    import DataUserPeerConnection from '~socializer/components/WebRTC/widgets/DataUserPeerConnection.vue'
    import { usePeerStore } from '~socializer/stores/peers.js'
    import { mapActions, mapState } from 'pinia'
    import { useMeStore } from '~estarter/stores/me.js'
    import { useServerStore } from '~socializer/stores/server.js'

    export default {
        name: "Whiteboard",
        components: {
          DataUserPeerConnection,
          RoomUsersList: defineAsyncComponent(() => import('~socializer/components/Server/widgets/RoomUsersList.vue')),
        },
        props: {
          users: {
            type: Array,
            required: true,
          },
          room: {
            type: Object,
            required: true,
          },
          displayCollaborators: {
              type: Boolean,
              required: false,
              default: true,
          }
        },
        data() {
          return {
            pointers: {},
          };
        },
        computed: {
          ...mapState(useMeStore, {
                me: 'getMe',
            }),
          ...mapState(useServerStore, {
              serverId: 'getCurrentServeId',
          }),
          isSavable: function() {
            if(this.whiteboardRoom) {
              return this.whiteboardRoom.save_board == 1
            }
           return 0
          },
          whiteBoardId: function() {
            if(this.whiteboardRoom) {
              return this.whiteboardRoom.id
            }
          },
          whiteboardRoom: function() {
            // is alone in room or subcontent
            if(this.room) {
                if(this.room.hasOwnProperty('content') && this.room.content) {
                  return this.room.content[0]
              }
              return this.room
            }
           // return null
          }
        },
        created() {
          if(this.isSavable) {
            this.loadScene()
          }
        },
        mounted() {
         // this.$refs.excalidrawElement.addEventListener("excalidraw-change", this.handleExcalidrawChange);
          this.$refs.excalidrawElement.addEventListener("excalidraw-mouseup", this.handleExcalidrawMouseUp);
          this.$refs.excalidrawElement.addEventListener("excalidraw-pointer", this.handlePointerMove);
        },
        beforeUnmount() {
        //  this.$refs.excalidrawElement.removeEventListener("excalidraw-change", this.handleExcalidrawChange);
          this.$refs.excalidrawElement.removeEventListener("excalidraw-mouseup", this.handleExcalidrawMouseUp);
          this.$refs.excalidrawElement.removeEventListener("excalidraw-pointer", this.handlePointerMove);
        },
        methods: {
          ...mapActions(usePeerStore, [
                'sendData',
            ]),
          ...mapActions(useServerStore, [
                'loadWhiteBoard',
                'saveWhiteBoard',
            ]),

          /*------  DATA CONNECTION ----------*/
          connectionDataCallback(conn) {
              console.log('nouvelle connexion data board')
                conn.on("data", (data) => {
                  data = JSON.parse(data)
                    switch(data.action) {
                        case 'update_scene':
                          if (this.$refs.excalidrawElement?.updateScene) {
                            this.$refs.excalidrawElement?.updateScene(data.details);
                          } else {
                            //console.error("updateScene() n'est pas encore disponible.");
                          }
                          break
                        case 'pointer_move':
                          this.pointers[data.from] = data.details;
                          break
                    }
                });
                conn.on("open", () => {
                    console.log('connection data board ouverte')
                });
                conn.on("close", () => {
                    console.log('connection data board fermée')
                });
          },
          // handleExcalidrawChange(event) {
          //   const data = event.detail;
          //   this.sendData({
          //         action: 'update_scene',
          //         from: this.me.name,
          //         details: data,
          //     }, this.room.id)
          // },
          handleExcalidrawMouseUp(event) {
            const data = event.detail

            this.sendData({
              data: {
                    action: 'update_scene',
                    from: this.me.name,
                    details: data,
                }
              }, this.whiteBoardId)

              if(this.isSavable) {
                this.saveScene(data)
              }
          },
          handlePointerMove(event) {
            const data = event.detail;
            this.sendData({
              data:{
                action: 'pointer_move',
                from: this.me.name,
                details: data,
              }
            }, this.whiteBoardId)
          },
          handleFileUpload(event) {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                  this.$refs.excalidrawElement?.importLibrary(e.target.result);
                };
                reader.readAsText(file);
            }
          },
          loadScene() {
           this.loadWhiteBoard({
                server_id: this.serverId,
                room_id: this.whiteBoardId,
                vertex_id: this.whiteBoardId,
            }).then ( payload => {
              this.$refs.excalidrawElement?.updateScene(payload);
            })
          },
          saveScene(data) {
            this.saveWhiteBoard({
                server_id: this.serverId,
                room_id: this.whiteBoardId,
                vertex_id: this.whiteBoardId,
                data
              })
          }
        }
    };
  </script>
  
  <style>
    .whiteboard {
      width: 100%;
      height: 94%;
    }
    .pointer {
      position: absolute;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      pointer-events: none;
      transition: transform 0.1s linear;
      z-index: 1000;
    }

  </style>