<template>
    <RoomUsersList v-if="displayCollaborators" :users="users"></RoomUsersList>
     <div class="whiteboard" v-show="loaded">
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
            loaded: false,
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

          const myComponent = document.querySelector('excalidraw-element');
          const shadow = myComponent.shadowRoot;
          setTimeout(() => {
            // v.0.18: break change position svgLayer ( dans le shadow room)
            // a suivre
            const el = shadow.querySelector('.SVGLayer');
            el.style.position = 'absolute';
            this.loaded = true;
          }, 100);

          setTimeout(() => {
            // v.0.18: break change probleme avec le css de la modale
            const el = shadow.querySelector('.layer-ui__wrapper__footer-right');
            el.remove();
          }, 1000);

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
              console.log('nouvelle connexion data board', conn.connectionId)
                conn.on("data", (data) => {
                  data = JSON.parse(data)

                    switch(data.action) {
                        case 'update_scene':
                          this.updateScene(data.details)
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
          async handleFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return
            
            const reader = new FileReader();
            // sert a importer une librairie d'éléments excalidraw
            // voir si ça marche
            // reader.onload = (e) => {
            //   this.$refs.excalidrawElement?.importLibrary(e.target.result);
            // };
            reader.readAsText(file);
              
          },
          loadScene() {
           this.loadWhiteBoard({
                server_id: this.serverId,
                room_id: this.whiteBoardId,
                vertex_id: this.whiteBoardId,
            }).then ( payload => {
               this.updateScene(payload)              
            })
          },
          saveScene(data) {
            this.saveWhiteBoard({
                server_id: this.serverId,
                room_id: this.whiteBoardId,
                vertex_id: this.whiteBoardId,
                data
              })
          },
          updateScene(data) {
            if (this.$refs.excalidrawElement?.updateScene) {

              if(data.hasOwnProperty('files')) {
                this.safeAddFilesToExcalidraw(this.$refs.excalidrawElement, data.files)
              }

              setTimeout(() => {
                this.$refs.excalidrawElement?.updateScene(data)
              }, 500);

            } else {
              console.error("updateScene() n'est pas encore disponible.");
            }
          },
          // Gestion robuste de l'ajout de fichiers dans Excalidraw
          // bug fix mais trouver le vrai format attendu par excalidraw
          safeAddFilesToExcalidraw(ref, files) {
            if (!ref) {
              console.error("Excalidraw ref introuvable.");
              return;
            }
            const addFn = ref.addFiles ?? (ref.excalidrawAPI && ref.excalidrawAPI.addFiles);
            if (typeof addFn !== "function") {
              console.error("addFiles introuvable sur le ref Excalidraw :", addFn);
              return;
            }

            // Normalise en plain object si c'est un objet (ex: Object.create(null) ou prototype custom)
            let normalized = files;
            if (files && typeof files === "object" && !Array.isArray(files)) {
              normalized = Object.assign({}, files);
            }

            // Première tentative : envoyer tel quel (format attendu en 0.18 : objet indexé)
            try {
              addFn.call(ref, normalized);
              console.log("addFiles: succès avec le format normalisé.");
              return;
            } catch (err) {
              console.warn("addFiles a levé une erreur au premier essai :", err && err.message);
              // si erreur reduce -> retenter avec un tableau de valeurs
              if (err && /reduce is not a function/i.test(err.message)) {
                try {
                  const arr = Array.isArray(normalized) ? normalized : Object.values(normalized);
                  addFn.call(ref, arr);
                  console.log("addFiles: succès avec Object.values(normalized).");
                  return;
                } catch (err2) {
                  console.error("addFiles a aussi échoué avec Object.values :", err2);
                  throw err2;
                }
              } else {
                // autre erreur : remonter (ou logguer)
                console.error("addFiles error (non reduce) :", err);
                throw err;
              }
            }
          }
        },
    };
  </script>
  
  <style>
    .whiteboard {
      width: 100%;
      height: 100%;
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