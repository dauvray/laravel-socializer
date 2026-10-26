<template>
    <!--
        Salon audio = DIFFUSION de salon, donc `mode="stream"` : chacun diffuse son micro à tous
        les membres présents. `visio` et `vocal` sont les chemins d'APPEL DIRECT (FSM d'appel,
        `Notifications`) et n'ont rien à faire ici.

        ⚠️ En mode `stream`, le provider ne crée AUCUN player (`useStreamManager.handleStreamReceived`) :
        c'est à ce composant de rendre les flux distants, sinon personne n'entend personne. La v1
        les injectait dans le `#videoContainer` de `Notifications` ; ils sont désormais rendus ici.

        `callbacks` est passé VIDE, et ce n'est pas un oubli : sa seule présence fait appeler
        `initialize()` par le provider, et les wraps internes de l'orchestrateur — registre des
        flux distants, annonce de diffusion — sont posés même sans callback applicatif.
    -->
    <MediaBroadcastProvider
        ref="audioBroadcast"
        v-if="users && room?.id"
        :users="users"
        :room="room.id"
        mode="stream"
        :callbacks="audioCallbacks"
        v-slot="{ api }"
    >
        <div class="d-flex flex-wrap gap-2 m-2">
            <!--
                `:videoActive="false"` : tout flux de ce contexte est audio seul (`getAudioStream`).
                `RemoteMediaPlayer` le rendrait dans un `<video>` noir — son `videoActive` vaut
                `true` tant que le pair n'a rien annoncé.
            -->
            <MediaBroadcastPlayer
                v-for="remote in api.remoteStreams.value"
                :key="`${remote.remoteSlug}-${remote.remoteType}`"
                :streamData="remoteStreamData(remote)"
                :videoActive="false"
            />
        </div>
    </MediaBroadcastProvider>

    <div class="chat-header m-2">
        <RoomUsersList :users="users"></RoomUsersList>
    </div>
</template>

<script>
    import RoomUsersList from '~socializer/components/Server/widgets/RoomUsersList.vue'
    import MediaBroadcastProvider from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue'
    import MediaBroadcastPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue'

    export default {
        name: 'AudioComponent',
        inject: ['AWN'],
        props: {
            room: {
                type: Object,
                required: false,
                default: null,
            },
            users: {
                type: Array,
                required: true
            },
        },
        components: {
            RoomUsersList,
            MediaBroadcastProvider,
            MediaBroadcastPlayer,
        },
        data() {
            return {
                audioCallbacks: {},
            }
        },
        mounted() {
            // Entrer dans le salon ouvre le micro, comme en v1 — il n'y a pas de bouton. Le
            // provider est monté avant ce hook (enfant d'abord) et l'a déjà initialisé.
            //
            // Pas d'arrêt symétrique au démontage : `api.cleanup()`, appelé par le provider,
            // arrête les flux locaux (`usePeerOrchestrator.teardown.test.js` § « flux locaux »).
            this.$refs.audioBroadcast?.api.getAudioStream().catch(this.notifyMicrophoneFailure)
        },
        methods: {
            /**
             * Nom affiché d'un flux distant : celui de la liste de présence, signée par le serveur.
             *
             * Jamais `remote.metadata.fromName` : en mode `stream`, le flux de RÉPONSE d'un pair
             * arrive sur MA connexion sortante, dont la metadata porte mon nom — et le registre
             * garde la première entrée reçue. `remoteSlug` est l'identité résolue du distant.
             */
            remoteStreamData(remote) {
                const member = this.users.find((user) => user.slug === remote.remoteSlug)

                return {
                    stream: remote.stream,
                    metadata: {
                        fromName: member?.name || remote.remoteSlug,
                        isMe: false,
                    },
                }
            },
            /**
             * Le refus du micro est le cas nominal d'un rejet de `getAudioStream` — sans ce
             * `.catch`, il devient un rejet non traité et le salon reste muet sans un mot.
             */
            notifyMicrophoneFailure(err) {
                const causes = {
                    NotAllowedError: 'autorisez l’accès au micro dans votre navigateur, puis rechargez la page',
                    NotFoundError: 'aucun micro disponible',
                    NotReadableError: 'le micro est déjà utilisé par une autre application',
                }

                this.AWN?.alert(`${err?.name ?? 'Erreur'} : ${causes[err?.name] ?? 'le micro n’a pas pu démarrer'}`)
            },
        },
    }
</script>
