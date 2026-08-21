<template>
<div>
    <router-link :to="{ name: 'server', params: { serverId: $route.params.serverId }}" class="server-name">
        {{ server.name }}
    </router-link>
    <div class="dropdown server-users">
        <button
            class="btn p-0"
            type="button"
            :title="presenceLabel"
            data-bs-toggle="dropdown"
            aria-expanded="false">
            <IconWidget icon="user-friends"></IconWidget> {{ serverUsersTotal }}
        </button>
        <div class="dropdown-menu">
            <h6 class="dropdown-header">Présents sur ce serveur ({{ serverUsersTotal }})</h6>
            <ServerUsersList
                v-if="serverUsersTotal"
                :users="serverUsers"
            ></ServerUsersList>
            <p v-else class="dropdown-item-text mb-0">
                Connexion au canal de présence…
            </p>
        </div>
    </div>
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
    import ServerUsersList from './ServerUsersList.vue'
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
            ServerUsersList,
        },
        props: {
            server: {
                type: Object,
                required: true
            },
            /**
             * Membres actuellement souscrits au canal de présence `server.{id}` — et non les
             * membres inscrits au serveur. La liste elle-même est passée, pas seulement son
             * cardinal : un nombre nu et non auditable a déjà fait passer une information
             * correcte pour un bug.
             *
             * @type {import('vue').PropType<Array<{id: number, name: string}>>}
             */
            serverUsers: {
                type: Array,
                required: false,
                default: () => []
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
            serverUsersTotal: function() {
                return this.serverUsers.length
            },
            /**
             * `is_me` de la charge utile de présence est inutilisable — il vaut `true` pour tout
             * le monde (voir `ServerUsersList.isMe`). C'est le store `me` qui tranche.
             *
             * @return {boolean}
             */
            isMePresent: function() {
                return this.serverUsers.some(user => user.id === this.getMe?.id)
            },
            /**
             * Dit ce que le chiffre compte, en distinguant « vous » des autres. Le cas
             * « je ne suis pas dans la liste » est traité à part : la présence n'est pas encore
             * synchronisée, et parler de « vous et N autres » y serait faux.
             *
             * @return {string}
             */
            presenceLabel: function() {
                if(!this.serverUsersTotal) {
                    return "Personne n'est présent sur ce serveur"
                }

                if(!this.isMePresent) {
                    return this.serverUsersTotal === 1
                        ? '1 personne présente sur ce serveur'
                        : `${this.serverUsersTotal} personnes présentes sur ce serveur`
                }

                const others = this.serverUsersTotal - 1

                if(!others) {
                    return 'Vous êtes seul présent sur ce serveur'
                }

                return others === 1
                    ? 'Vous et 1 autre personne présente sur ce serveur'
                    : `Vous et ${others} autres personnes présentes sur ce serveur`
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