<template>
    <div class="classroom-wrapper">
        <RoomUsersList :users="users"></RoomUsersList>
        <div class="classroom">
             <ChatComponent
                v-if="chatId && showChat"
                ref="chat"
                v-resizable-width="{
                    min: 400,
                    max: 800,
                    callback: updateChatWidth
                }"
                :vertexId="chatId"
                :displayUsers="false"
            ></ChatComponent>
           <WhiteboardComponent
                v-if="showWhiteboard && whiteboardRoom"
                ref="whiteboard"
                :room="whiteboardRoom"
                :users="users"
                :displayCollaborators="false"
            ></WhiteboardComponent>
        </div>
        <!--
            En FIN de `.classroom-wrapper`, et pas à la place de l'ancien tag v1 : celui-ci
            ne rendait aucun nœud (`<template></template>`), le provider v2 rend un `<div>`.
            Le laisser au niveau racine ferait passer le composant de UN à DEUX nœuds racine
            RENDUS, dans un `.room-content-main` qui est lui-même item flex de
            `.room-content-layout`. Même geste qu'au Whiteboard et à Application, chacun en
            fin de son propre wrapper.

            `:room` TOUJOURS explicite : sans elle la prop retombe sur 'app' et le contextId
            devient `data-app`, celui que System/Notifications.vue occupe en permanence sur
            toute page. Le registre de contextes est en last-write-wins MUET : le dernier
            monté capterait tout le routage entrant et celui-ci resterait vivant et sourd.

            `mode` non écrit ('data' est le défaut) et `options` NON PASSÉE : un objet
            remplacerait le défaut EN BLOC, faisant disparaître `topology`, qui retomberait
            alors silencieusement sur le mesh dont ce module a besoin.
            ⚠️ Ce module a besoin de MESH, et il n'a jamais été en star : la ligne
            `docs/modules/autres-modules.md` qui l'annonçait « cas d'usage type de la
            topologie star » était fausse — la v1 qu'il utilisait n'avait aucune notion de
            topologie. Corrigée le 01/09/2026 ; ne pas la ressusciter en passant `options`.

            Le contexte de ce provider (`data-<room.id>`) est DISTINCT de celui du
            Whiteboard imbriqué ci-dessus (`data-<subcontent.id>`) : deux contextes sur le
            même Peer singleton, forme couverte par
            `WebRTC2/__tests__/scenarios/multiContext.test.js`.
        -->
        <MediaBroadcastProvider
            ref="dataBroadcast"
            v-if="users && room.id"
            :users="users"
            :room="room.id"
            :callbacks="dataCallbacks"
        ></MediaBroadcastProvider>
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
</template>

<script>

    import ChatComponent from  '~socializer/components/Chat/ChatComponent.vue'
    import WhiteboardComponent from '~socializer/components/Whiteboard/WhiteboardComponent.vue'
    import MediaBroadcastProvider from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue'
    import RoomUsersList from '~socializer/components/Server/widgets/RoomUsersList.vue'
    import ConfigPanel from './ConfigPanel.vue'
    import { mapState } from 'pinia'
    import { useMeStore } from '~estarter/stores/me.js'
    import resizableWidth from "~socializer/directives/resizable_width.js";

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
            MediaBroadcastProvider,
        },
        directives: {
            resizableWidth,
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
            /**
             * Sous-contenus du salon, ou tableau vide s'il n'y en a aucun.
             *
             * ⚠️ `hasOwnProperty('subcontent')` ne suffit PAS, et c'est ce qui cassait la page :
             * il teste la PRÉSENCE de la clé, pas sa valeur. Or `Services/Server#getRoom` pose
             * délibérément `subcontent` à **`null`** quand il n'y en a pas
             * (`count($result['subcontent']) ? … : null`) — la clé est donc bien là, et
             * `.forEach` levait dessus.
             *
             * Le cas se produit pour tout salon dont les sous-contenus manquent : une création
             * interrompue (le bug de `createClassroomVertice`, corrigé le 01/09/2026), mais
             * aussi, légitimement, un salon dont le chat a été supprimé. Le garde reste donc
             * nécessaire après ce correctif-là.
             *
             * @returns {Array<{ id: string, content_type: string }>}
             */
            subcontents: function() {
                return Array.isArray(this.room?.subcontent) ? this.room.subcontent : []
            },
            chatId: function() {
                let chat_id = null

                this.subcontents.forEach(subcontent => {
                    if(subcontent.content_type === 'chat') {
                        chat_id = subcontent.id
                    }
                })

                return chat_id
            },
            whiteboardRoom: function() {
                let whiteboard_room = null

                this.subcontents.forEach(subcontent => {
                    if(subcontent.content_type === 'whiteboard') {
                        whiteboard_room = subcontent
                    }
                })

                return whiteboard_room
            },
            /**
             * Callbacks du canal data, passés au MediaBroadcastProvider.
             *
             * ⚠️ `:callbacks` XOR une initialisation de l'api dans un enfant, jamais les
             * deux : le stockage est write-once par clé et le second jeu serait perdu EN
             * SILENCE. Ici il n'y a pas d'enfant dans le slot, donc c'est bien cette voie.
             *
             * Le provider ne lit cet objet qu'une fois, en onMounted : sa réactivité de
             * computed ne sert à rien. C'est la méthode qu'il pointe qui voit l'état frais,
             * par `this`.
             *
             * ℹ️ **Une seule clé, et c'est le fait qui caractérise ce module.** Les deux
             * autres appelants data ont dû poser un garde de sens `isIncomingConnection`,
             * parce qu'`onConnectionOpen`/`onConnectionClose` tirent dans les DEUX sens là
             * où le `callbackConnection` de la v1 n'était appelé que sur l'entrant. Celui-ci
             * n'en a pas besoin : sa v1 ne portait AUCUN effet de bord de connexion — trois
             * `console.log`, non reportés (01/09/2026). Ne pas ajouter `onConnectionOpen`
             * ici sans relire `docs/modules/webrtc2/api.md` sur le double sens.
             *
             * @returns {{ onDataReceived: Function }}
             */
            dataCallbacks: function() {
                return {
                    onDataReceived: this.handleDataReceived,
                }
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
            updateChatWidth(newWidth) {
                this.chatWidth = newWidth;
            },
            /*------  DATA CONNECTION ----------*/
            /**
             * Réception sur le canal data : les bascules d'affichage du pair éditeur.
             *
             * ⚠️ Aucun JSON.parse : le `sendData` de la v2 émet le payload TEL QUEL, là où le
             * store v1 le sérialisait avant d'envoyer. Le `JSON.parse` qui vivait ici
             * recevrait un objet et lèverait.
             *
             * ⚠️ Et surtout : ne JAMAIS poser de `conn.on('data')` soi-même. Le transport
             * possède déjà ce listener — un second doublerait chaque réception ET
             * contournerait la garde de taille en entrée comme l'interception des enveloppes
             * d'infra. Le geste est ce callback, pas `conn.on('data')`.
             *
             * @param {{ action: string, from: string, value: boolean }} data
             * @returns {void}
             */
            handleDataReceived(data) {
                switch(data.action) {
                    case 'whiteboard-toggle':
                        this.showWhiteboard = data.value
                      break
                    case 'chat-toggle':
                        this.showChat = data.value
                      break
                }
            },
            /**
             * Propage l'affichage du tableau blanc aux autres membres de la salle.
             *
             * `?.` : le provider est sous `v-if`, alors que ce handler vient de `ConfigPanel`,
             * monté dans un `<Teleport>` sous son propre `v-if="editable"`. L'ancien
             * `sendData` était une action de store, donc toujours appelable ; ce ref-ci vaut
             * `undefined` si le `v-if` du provider est faux.
             *
             * Pas d'argument de room : elle est figée dans le contexte du provider. Et pas
             * d'enveloppe `{ data: … }` : la v2 émet le payload directement.
             *
             * @param {boolean} value
             * @returns {void}
             */
            handleShowWhiteboard(value) {
                this.showWhiteboard = value
                this.$refs.dataBroadcast?.api.sendData({
                    action: 'whiteboard-toggle',
                    from: this.me.name,
                    value: value,
                })
            },
            /**
             * Pendant exact de handleShowWhiteboard, pour le chat.
             *
             * @param {boolean} value
             * @returns {void}
             */
            handleShowChat(value) {
                this.showChat = value
                this.$refs.dataBroadcast?.api.sendData({
                    action: 'chat-toggle',
                    from: this.me.name,
                    value: value,
                })
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