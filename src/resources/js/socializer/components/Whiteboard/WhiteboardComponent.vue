<template>
    <div class="board-wrapper">
      <ChatCreatorButton></ChatCreatorButton>
      <RoomUsersList v-if="displayCollaborators" :users="users"></RoomUsersList>
      <div class="whiteboard" v-show="loaded">
          <excalidraw-element ref="excalidrawElement"></excalidraw-element>
          <div v-for="(pointer, id) in pointers" :key="id" 
              class="pointer" 
              :style="{ left: pointer.x + 'px', top: pointer.y + 'px' }">
            👆 <span class="badge text-bg-light">{{ id }}</span>
          </div>
      </div>
      <!--
        `:room` TOUJOURS explicite : sans elle la prop retombe sur 'app' et le contextId
        devient `data-app`, celui que System/Notifications.vue occupe en permanence sur
        toute page. Le registre de contextes est en last-write-wins MUET : le dernier
        monté capterait tout le routage entrant et celui-ci resterait vivant et sourd.

        `mode` non écrit ('data' est le défaut) et `options` non passée : un objet
        remplacerait le défaut EN BLOC, faisant disparaître `topology` — qui retomberait
        alors silencieusement sur le mesh dont ce module a besoin.
      -->
      <MediaBroadcastProvider
          ref="dataBroadcast"
          v-if="users && whiteBoardId"
          :users="users"
          :room="whiteBoardId"
          :callbacks="dataCallbacks"
      ></MediaBroadcastProvider>
    </div>
</template>

  <script>

    import { defineAsyncComponent } from '@vue/runtime-core'
    import "./ExcalidrawElement.jsx"; // Import du Web Component
    import MediaBroadcastProvider from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue'
    import { mapActions, mapState } from 'pinia'
    import { useMeStore } from '~estarter/stores/me.js'
    import { useServerStore } from '~socializer/stores/server.js'
    import ChatCreatorButton from '~socializer/components/Chat/widgets/ChatCreatorButton.vue'

    export default {
        name: "Whiteboard",
        components: {
          MediaBroadcastProvider,
          RoomUsersList: defineAsyncComponent(() => import('~socializer/components/Server/widgets/RoomUsersList.vue')),
          ChatCreatorButton,
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
           return false
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
          },
          /**
           * Callbacks du canal data, passés au MediaBroadcastProvider.
           *
           * ⚠️ `:callbacks` XOR une initialisation de l'api dans un enfant, jamais les
           * deux : le stockage est write-once par clé et le second jeu serait perdu EN
           * SILENCE. Ici il n'y a pas d'enfant dans le slot, donc c'est bien cette voie.
           *
           * Le provider ne lit cet objet qu'une fois, en onMounted : sa réactivité de
           * computed ne sert à rien. Ce sont les méthodes qu'il pointe qui voient l'état
           * frais, par `this`.
           *
           * @returns {{ onDataReceived: Function, onConnectionOpen: Function }}
           */
          dataCallbacks: function() {
            return {
              onDataReceived: this.handleDataReceived,
              onConnectionOpen: this.handleConnectionOpen,
            }
          },
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
          }, 500);

          setTimeout(() => {
            // v.0.18: break change probleme avec le css de la modale
            const el = shadow.querySelector('.layer-ui__wrapper__footer-right');
            if(el) {
              el.remove();
            }
           
          }, 1000);

        },
        beforeUnmount() {
        //  this.$refs.excalidrawElement.removeEventListener("excalidraw-change", this.handleExcalidrawChange);
          this.$refs.excalidrawElement.removeEventListener("excalidraw-mouseup", this.handleExcalidrawMouseUp);
          this.$refs.excalidrawElement.removeEventListener("excalidraw-pointer", this.handlePointerMove);
        },
        methods: {
          ...mapActions(useServerStore, [
                'loadWhiteBoard',
                'saveWhiteBoard',
            ]),

          /*------  DATA CONNECTION ----------*/
          /**
           * Réception sur le canal data.
           *
           * ⚠️ Aucun JSON.parse : le sendData de la v2 émet le payload TEL QUEL, là où le
           * store v1 le sérialisait avant d'envoyer. Un JSON.parse laissé en place
           * recevrait un objet et lèverait.
           *
           * ⚠️ Et surtout : ne JAMAIS poser de conn.on('data') soi-même. Le transport
           * possède déjà ce listener — un second doublerait chaque réception ET
           * contournerait la garde de taille en entrée comme l'interception des
           * enveloppes d'infra. Le geste est ce callback, pas conn.on('data').
           *
           * @param {{ action: string, from: string, details: Object }} data
           * @returns {void}
           */
          handleDataReceived(data) {
            switch(data.action) {
                case 'update_scene':
                  this.updateScene(data.details)
                  break

                case 'pointer_move':
                  this.pointers[data.from] = data.details;
                  break
            }
          },
          /**
           * Renvoie la scène courante à un arrivant : c'est ce qui fait qu'il voit le
           * tableau déjà tracé. Sous `isSavable`, il le charge du serveur à la place.
           *
           * ⚠️ Restreint aux connexions ENTRANTES, et ce garde n'est pas cosmétique : le
           * `callbackConnection` de la v1 n'était appelé QUE sur l'entrant, alors que
           * `onConnectionOpen` l'est dans les DEUX sens (`setUpConnectionListeners` est
           * appelé par `usePeerConnections` au sortant ET par `usePeerTransport` à
           * l'entrant). En mesh chaque paire a deux connexions : sans ce garde, chaque
           * pair renverrait sa scène deux fois par arrivant.
           *
           * Le sens se lit sur la metadata, construite par l'émetteur de la connexion :
           * sur une SORTANTE `from` est mon slug, sur une ENTRANTE c'est celui du pair.
           *
           * @param {Object} conn  DataConnection PeerJS
           * @returns {void}
           */
          handleConnectionOpen(conn) {
            if(this.isSavable) {
              return
            }

            if(!this.me?.slug || conn?.metadata?.from === this.me.slug) {
              return
            }

            setTimeout(() => {
              const elements = this.$refs.excalidrawElement.getSceneElements()

              if(elements.length > 0) {
                const current = {
                    elements,
                    appState: this.$refs.excalidrawElement.getAppState(),
                    files: this.$refs.excalidrawElement.getFiles(),
                }

                this.handleExcalidrawMouseUp({ detail: current });
              }
            }, 1000); // attendre que excalidraw soit prêt
          },
          // handleExcalidrawChange(event) {
          //   const data = event.detail;
          //   this.sendData({
          //         action: 'update_scene',
          //         from: this.me.name,
          //         details: data,
          //     }, this.room.id)
          // },
          /**
           * ⚠️ L'`appState` est RETIRÉ de l'émission, et ce n'est pas une optimisation :
           * sans ce retrait, rien ne se propage du tout.
           *
           * 1. `getAppState()` rend un `appState` dont `collaborators` est une **Map**
           *    (Excalidraw 0.18). La sérialisation par défaut de PeerJS est BinaryPack,
           *    qui **lève** dessus — et le throw est synchrone dans le `forEach` de
           *    `sendData` : il abandonne les pairs suivants ET le `saveScene` ci-dessous,
           *    donc il cassait aussi la persistance sur un tableau `isSavable`. La v1 ne
           *    le voyait pas : elle passait par `safeStringify`, donc une chaîne partait
           *    sur le fil et la Map y devenait `{}` en silence.
           * 2. ⚠️ Le garde de taille de `sendData` ne peut PAS l'attraper : il mesure via
           *    `JSON.stringify`, qui accepte une Map. Le trou est précis — un conteneur
           *    que JSON accepte et que BinaryPack refuse.
           * 3. Et surtout : **le récepteur ne l'a jamais lu.** `ExcalidrawElement.updateScene`
           *    lit `data.state`, une clé que personne n'émet (ni ici, ni le serveur) —
           *    l'`appState` transmis était mort avant même la v2. Le retirer n'enlève donc
           *    rien à personne.
           *
           * ℹ️ Le payload restant, `elements` + `files`, est sûr par construction (objets
           * plats du format .excalidraw, et un Record de dataURL). Reste la borne de
           * MAX_PAYLOAD_BYTES (64 Ko) : au-delà l'envoi est abandonné, avec un
           * `console.warn` pour seule trace. Le terme dominant est désormais `files` —
           * une image collée y suffit. Borne assumée, voir work/webrtc-data-v1-v2.md.
           */
          handleExcalidrawMouseUp(event) {
            const data = event.detail
            const { appState, ...transportable } = data

            // `?.` : le provider est sous v-if alors que les deux listeners DOM sont
            // posés inconditionnellement en mounted(). L'ancien sendData était une action
            // de store, donc toujours appelable ; ce ref-ci vaut undefined si le v-if est
            // faux. Pas d'argument de room : elle est figée dans le contexte du provider.
            this.$refs.dataBroadcast?.api.sendData({
                action: 'update_scene',
                from: this.me.name,
                details: transportable,
            })

              if(this.isSavable) {
                // `data` entier, appState compris : le format stocké côté serveur est
                // relu par loadScene() et ne relève pas de ce qui part sur le fil.
                this.saveScene(data)
              }
          },
          handlePointerMove(event) {
            const data = event.detail;
            this.$refs.dataBroadcast?.api.sendData({
              action: 'pointer_move',
              from: this.me.name,
              details: data,
            })
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
    .board-wrapper,
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