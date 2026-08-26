<template>
<div>
    <router-link :to="{ name: 'server', params: { serverId: $route.params.serverId }}" class="server-name">
        {{ server.name }}
    </router-link>
    <div class="dropdown server-users">
        <button
            class="btn p-0"
            type="button"
            :title="connectionLabel"
            data-bs-toggle="dropdown"
            aria-expanded="false">
            <IconWidget icon="user-friends"></IconWidget> {{ serverUsersTotal }}
        </button>
        <div class="dropdown-menu">
            <h6 class="dropdown-header">Connectés à ce serveur ({{ serverUsersTotal }})</h6>
            <ServerUsersList
                v-if="serverUsersTotal"
                :users="serverUsers"
            ></ServerUsersList>
            <p v-else class="dropdown-item-text mb-0">
                Connexion en cours…
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
             * ⚠️ Une souscription est un **onglet ouvert**, pas une personne active : un onglet
             * d'arrière-plan est compté. C'est l'arbitrage retenu — les libellés de ce composant
             * disent donc « connecté » et jamais « présent »
             * (`docs/architecture/signalisation.md#ce-que-la-présence-mesure--un-onglet-ouvert`).
             *
             * @type {import('vue').PropType<Array<{id: number, name: string, slug: string}>>}
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
             * C'est le store `me` qui tranche : la charge utile de présence ne porte plus de
             * `is_me` (E8), et quand elle en portait il valait `true` pour tout le monde
             * (voir `ServerUsersList.isMe`).
             *
             * @return {boolean}
             */
            isMeConnected: function() {
                return this.serverUsers.some(user => user.id === this.getMe?.id)
            },
            /**
             * Dit ce que le chiffre compte, en distinguant « vous » des autres.
             *
             * Le vocabulaire est **« connecté », jamais « présent »** : ce qui est compté, ce sont
             * les souscriptions au canal `server.{id}`, donc des onglets ouverts — un onglet
             * d'arrière-plan compte. L'infobulle nomme cette borne au lieu de la laisser deviner ;
             * c'est un compteur juste pris pour un bug qui a coûté ce détour.
             *
             * Le cas zéro ne dit pas « personne » : on est toujours dans sa propre liste de
             * présence dès que la souscription tient, donc zéro signifie que le `here` de Reverb
             * n'est pas encore arrivé — et l'affirmer vide serait faux.
             *
             * @return {string}
             */
            connectionLabel: function() {
                if(!this.serverUsersTotal) {
                    return 'Connexion en cours…'
                }

                const withNuance = sentence => `${sentence} — un onglet ouvert suffit à être compté`

                if(!this.isMeConnected) {
                    return withNuance(this.serverUsersTotal === 1
                        ? '1 personne connectée à ce serveur'
                        : `${this.serverUsersTotal} personnes connectées à ce serveur`)
                }

                const others = this.serverUsersTotal - 1

                if(!others) {
                    return withNuance('Vous êtes seul connecté à ce serveur')
                }

                return withNuance(others === 1
                    ? 'Vous et 1 autre personne connectée à ce serveur'
                    : `Vous et ${others} autres personnes connectées à ce serveur`)
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