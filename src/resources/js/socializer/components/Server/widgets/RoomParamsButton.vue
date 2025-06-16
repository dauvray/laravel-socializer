<template>

    <div class="d-flex flex-column w-100">
        <div class="d-flex">

            <router-link :to="{ name: 'room', params: { roomId:roomId, serverId: server.id } }" 
                class="room-name">
                <button 
                    :disabled="selected"
                    type="button" 
                    data-bs-toggle="collapse" 
                    :data-bs-target="`#collapser-${roomId}`" 
                    aria-expanded="false" 
                    :aria-controls="roomId">
                    <IconWidget :icon="roomIcon"></IconWidget> {{ room.name }}
                    <IconWidget v-if="room.privacy === 1" :icon="lockIcon"></IconWidget>
                </button>
            </router-link>

            <SortButtons
                v-if="isOwner" 
                :index="room.position-1"
                :length="serverRooms.length"
                classBtn="btn p-0"
                @sort-up-element="onSortUpRoom"
                @sort-down-element="onSortDownRoom"
            ></SortButtons>

            <button 
                v-if="isOwner && selected" 
                class="btn p-0" 
                type="button" 
                title="Paramétrages"
                data-bs-toggle="dropdown" 
                aria-expanded="false">
                <IconWidget icon="cog"></IconWidget>
            </button>
            <ul class="dropdown-menu" :id="`dropdown-menu-${roomId}`">
                <li>
                    <a class="dropdown-item" href="#" @click="onShowRoomParams">
                        <IconWidget icon="cog"></IconWidget> Parametres du salon
                    </a>
                </li>
                <li>
                    <a class="dropdown-item" href="#" @click="onAddSubRoom">
                        <IconWidget icon="plus-circle"></IconWidget> Ajouter sous-salon
                    </a>
                </li>
                <li :id="`dropdown-slot-${roomId}`"></li>
                <li><hr class="dropdown-divider"></li>
                <li>
                    <a class="dropdown-item text-danger" href="#" @click="onDeleteRoom">
                        <IconWidget icon="trash-alt"></IconWidget> Supprimer le salon
                    </a>
                </li>
            </ul>
            
        </div>

        <div class="collapse" :id="`collapser-${roomId}`" data-bs-parent="#collapseRoomGroup"></div>
    </div>

    <SettingsModal
        :questionnaireid="currentQuestionnaire"
        :isNew="true"
        :trigger="showModal"
        modalTitle="Configuration sous salon"
        @hide-modal="onCancelEditModal"
        @send-data="onQuestionnaireData"
    ></SettingsModal>

</template>

<script>

    import { defineAsyncComponent } from '@vue/runtime-core'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import FormsSettingHelper from '~socializer/services/FormsSetting.js'
    import { useServerStore } from '~socializer/stores/server.js'
    import { mapActions, mapState } from 'pinia'

    export default {
        name: 'RoomParamsButton',
        inject: ['AWN'],
        emits: [
            'delete-room',
            'edit-room',
            'sort-up-room',
            'sort-down-root',
        ],
        components: {
            IconWidget,
            SettingsModal: defineAsyncComponent(() => import('~socializer/components/Server/widgets/SettingsModal.vue')),
            SortButtons: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/atoms/SortButtons.vue')),
        },
        props: {
            room: {
                type: Object,
                required: true
            },
            server: {
                type: Object,
                required: true
            }
        },
        data() {
            return {
               roomId: this.room.id,
               selected: false,
               showModal: false,
               currentQuestionnaire: FormsSettingHelper.questionnaires.createServerRoom,
            }
        },
        watch: {
            '$route' (to) {
                this.initRoom(to)
            },
        },
        mounted() {
            this.initRoom(this.$route)
        },
        computed: {
            ...mapState(useServerStore, {
                isOwner: 'isOwner',
                currentContent: 'getCurrentContent',
                serverRooms: 'getServerRooms',
            }),
            roomIcon: function() {
                const mapIcon = {
                    'chat': 'hashtag',
                    'data': 'table',
                    'form': 'tasks',
                    'page': 'pager',
                }
                return mapIcon[this.room.room_type]
            },
            lockIcon: function() {
                if(this.room.registered_in) {
                    return 'unlock'
                }
                return 'lock'
            },  
        },
        methods: {
            ...mapActions(useServerStore, [
                'createSubContent',
            ]),
            initRoom(route) {
                if( route.params.hasOwnProperty('roomId') && route.params.roomId === this.roomId ) {
                    this.selected = true
                    document.getElementById(`collapser-${this.roomId}`).classList.add('show')
                } else  {
                    this.selected = false
                    document.getElementById(`dropdown-menu-${this.roomId}`).classList.remove('show')
                }
            },
            onDeleteRoom() {
                let onOk = () => {
                        this.$emit('delete-room', this.room.id)
                    }
                let onCancel = () => {}
                this.AWN.confirm(
                    'Etes-vous certain ?',
                    onOk,
                    onCancel,
                    {
                        labels : {
                            confirm: 'Supprimer',
                            confirmOk: "Valider",
                            confirmCancel: "Annuler",
                        }
                    }
                )
            },
            onShowRoomParams() {
                const { subContent, ...currentContent } = this.currentContent
                this.$emit('edit-room',{...currentContent, ...this.room})                  
            },
            onSortUpRoom(index) {
                this.$emit('sort-up-room', index)
            },
            onSortDownRoom(index) {
                this.$emit('sort-down-room', index)
            },

            /*--------------------------
            | SubRoom creation
            ---------------------------*/
            onAddSubRoom() {
                this.showModal = true
            },
            onCancelEditModal() {
                this.showModal = false
            },
            async onQuestionnaireData(formData){
                this.canValidate = false
                this.createSubContent({
                    content: formData.get('model'),
                    roomId: this.room.id,
                    serverId: this.server.id,
                })
            },
        }
    }
</script>