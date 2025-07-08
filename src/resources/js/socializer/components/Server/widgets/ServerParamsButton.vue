<template>
<div>
    <router-link :to="{ name: 'server', params: { serverId: $route.params.serverId }}" class="server-name">
        {{ server.name }}
    </router-link>
    <IconWidget icon="user-friends"></IconWidget> {{ serverUsersTotal  }}
    <div v-if="isOwner" class="dropdown">
        <button 
            class="btn p-0" 
            type="button" 
            title="Paramétrages"
            data-bs-toggle="dropdown" 
            aria-expanded="false">
            <IconWidget icon="cog"></IconWidget>
        </button>
        <ul class="dropdown-menu">
            <li>
                <a class="dropdown-item" href="#" @click="onCreateRoom">
                   <IconWidget icon="plus-circle"></IconWidget> Nouveau salon
                </a>
            </li>
            <li>
                <a class="dropdown-item" href="#" @click="onAddModule">
                   <IconWidget icon="plus-circle"></IconWidget> Ajouter un module
                </a>
            </li>
            <li>
                <a class="dropdown-item" href="#" @click="onEditServer">
                    <IconWidget icon="cog"></IconWidget> Paramètres du serveur
                </a>
            </li>
            <li>
                <a class="dropdown-item" style="cursor:pointer;" @click="onManageQuestionnaire">
                    <IconWidget icon="wpforms" prefix="lab"></IconWidget> Gestion des questionnaires
                </a>
            </li>
            <li><hr class="dropdown-divider"></li>
            <li>
                <a class="dropdown-item text-danger" href="#" @click="onDeleteServer">
                    <IconWidget icon="trash-alt"></IconWidget> Supprimer le serveur
                </a>
            </li>
        </ul>
    </div>
</div>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { useServerStore } from '~socializer/stores/server.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'

    export default {
        name: 'ServerParamsButton',
        inject: ['AWN'],
        emits: [
            'create-room',
            'delete-server',
            'edit-server',
            'add-module',
        ],
        components: {
            IconWidget,
        },
        props: {
            server: {
                type: Object,
                required: true
            },
            serverUsersTotal: {
                type: Number,
                required: false,
                default: null
            }
        },
        computed: {
            ...mapState(useServerStore, {
                ownerId: 'getOwnerId',
            }),
            ...mapState(useMeStore, {
                getMe: 'getMe',
            }),
            isOwner: function() {
                return this.ownerId === this.getMe.vertexid
            },
        },
        methods: {
            onCreateRoom(event) {
               this.$emit('create-room', event)
            },
            onEditServer() {
                this.$emit('edit-server', this.server)
            },
            onDeleteServer() {
                let onOk = () => {
                        this.$emit('delete-server', this.server.id)
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
            onManageQuestionnaire() {
                this.$router.push({ name: 'questionnaire-manager'})
            },
            onAddModule() {
                this.$emit('add-module')
            }
        }
    }
</script>