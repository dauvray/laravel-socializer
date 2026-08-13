<template>
    <div class="card">
        <div class="card-body">
            <div class="btn-group btn-group-sm" role="group">
                <GroupLocalStreamBtn
                    :api="api"
                ></GroupLocalStreamBtn>
            </div> 
            
            <div class="row">
                <div class="col">
                    <h5>Local Stream</h5>
                    <LocalMediaPlayer v-if="api.currentStream.value" :streamData="localStreamData">
                        <template #audio="audioProps">
                            <!-- <SpectrumAnalyzer v-bind="audioProps" /> -->
                        </template>
                    </LocalMediaPlayer>
                    
                    <LocalMediaPlayer v-if="api.screenStream.value" :streamData="screenStreamData" />
                </div>

                <div class="col">
                    <h5>Remote Streams</h5>

                    <!--
                        Pair dont un flux est ANNONCÉ (annonce data channel, ou appel
                        entrant déjà reçu) mais pas encore arrivé : l'établissement
                        (ICE, premières frames) peut prendre plusieurs secondes et sans
                        cette vignette l'attente se lit comme une panne.
                        Un pair qui ne diffuse pas n'apparaît JAMAIS ici — cf.
                        useAwaitedStreams / useBroadcastPresence.
                    -->
                    <div v-for="slug in awaitedPeers" :key="`awaited-${slug}`" class="draggable-video">
                        <div class="video-loading">
                            <Spinner color="#ffffff" />
                            <span class="video-loading-label">{{ slug }} — en attente du flux…</span>
                        </div>
                    </div>

                    <RemoteMediaPlayer
                        v-for="(remoteStream, index) in remoteStreamsData"
                        :key="remoteStream.metadata.peerId ?? index"
                        :streamData="remoteStream">
                        <template #audio="audioProps">
                            <!-- <SpectrumAnalyzer v-bind="audioProps" /> -->
                        </template>
                    </RemoteMediaPlayer>
                    
                    <RemoteMediaPlayer 
                        v-for="(remoteScreen, index) in remoteScreensData" 
                        :key="index" 
                        :streamData="remoteScreen" />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
    import { ref, computed, watch, onMounted, defineAsyncComponent } from 'vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { usePeer2Store } from '~socializer/stores/peers2.js'
    import LocalMediaPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/LocalMediaPlayer.vue'
    import RemoteMediaPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/RemoteMediaPlayer.vue'
    import GroupLocalStreamBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/GroupLocalStreamBtn.vue'
    import Spinner from '~estarter/components/widgets/Spinners/Spinner1.vue'
    import { useAwaitedStreams } from '~socializer/components/WebRTC2/Widgets/Mediaplayer/Composables/useAwaitedStreams.js'

    const props = defineProps({
        api: Object,
    })

    const meStore = useMeStore()
    const peerStore = usePeer2Store()

    // Pairs présents sans flux : vignette d'attente, bornée dans le temps.
    const { awaitedPeers } = useAwaitedStreams(props.api)

    const SpectrumAnalyzer = defineAsyncComponent({
        // La fonction de chargement (le dynamic import)
        loader: () => import('~socializer/components/WebRTC2/Widgets/UI/Audio/SpectrumAnalyzer.vue'),
        // Un composant à afficher pendant le chargement
        loadingComponent: Spinner,
        // Délai avant d'afficher le composant de chargement (par défaut : 200ms)
        delay: 200,
        // Un composant à afficher si le chargement échoue (optionnel)
        // errorComponent: ErrorComponent,
        // Durée maximale avant d'abandonner le chargement et afficher le composant d'erreur (par défaut : Infinity)
    })

    onMounted(() => {
        props.api.initialize({
            onDataReceived: handleStreamData,
            onStreamReceived: handleStreamReceived,
            onConnectionClose: handleStreamClose,
        })
    })

    /**
     * Callbacks pour la gestion des events de stream (reçus, fermés, données reçues sur les streams)
     */
     
    const handleStreamReceived = (stream, conn, metadata) => {
        console.log('Stream reçu dans chat', { stream, conn, metadata })
        peerStore.createSignalQueueRoom(conn.peer)
    }

    const handleStreamClose = (conn) => {
        // 1) On récupère les métadonnées transportées par PeerJS.
        //    Elles nous disent "qui a initié" cette connexion (metadata.from),
        //    et donc si la fermeture vient de nous ou d'un autre peer.
        const metadata = conn?.metadata || {}

        // 2) Cas critique à comprendre :
        //    Quand JE coupe MA webcam, certaines connexions sortantes se ferment.
        //    Ces connexions sortantes ont metadata.from = mon slug.
        //
        //    Si on supprimait remoteStreamsMap ici, on effacerait à tort des streams distants
        //    encore valides (ex: stream de B), juste parce que MA connexion sortante a fermé.
        //
        //    => Donc si la fermeture concerne une connexion que J'avais initiée,
        //       on ne touche pas à la liste des streams distants.
        if(metadata?.from && metadata.from === meStore.getMe?.slug) {
            return
        }
        
        // 3) Ici, on traite plutôt une fermeture liée à un peer distant.
        //    conn.peer correspond à l'id du peer distant associé à cette connexion.
        //    C'est la clé utilisée dans remoteStreamsMap au moment de handleStreamReceived.
        const peerId = conn?.peer || null

        // 4) On retire uniquement le stream de ce peer distant.
        //    On ne clear jamais toute la map, sinon on casserait les autres streams encore actifs.
        if (peerId) {
        console.log('Stream fermé par le peer', { peerId })
        }
    }

    const handleStreamData = (data, conn) => {
        console.log('Donnée reçue sur le stream', { data, conn })
        peerStore.dispatchSignal({
            emitter: 'StreamSimpleUI',
            roomId: conn?.peer,
            payload: data
        })
    }

    /**
     * Données formatées pour les composants vidéo (local, écran, distants) - 
     */

    const localStreamData = computed(() => ({ 
        stream: props.api.currentStream.value,
        metadata: {
            fromName: props.api.myName.value,
            roomId: props.api.onAirRoom.value,
            countViewers: props.api.usersInRoom.value.length,
            currentType: props.api.currentType.value,
            isMe: true,
            isAudioMuted: props.api.isMuted.value,
            isVideoEnabled: props.api.isVideoEnabled.value,
        }
    }))

    const screenStreamData = computed(() => ({ 
        stream: props.api.screenStream.value,
        metadata: {
            fromName: props.api.myName.value,
            roomId: props.api.onAirRoom.value,
            countViewers: props.api.usersInRoom.value.length,
            currentType: props.api.currentType.value,
            isMe: true,
        }
    }))

    const remoteStreamsData = computed(() => {

        const apiInstance = props.api
        if (!apiInstance) return []

        // On récupère le tableau (Vue gère l'unwrapping du computed automatiquement)
        const streams = apiInstance.remoteStreams?.value || apiInstance.remoteStreams || []

        return streams.map(rs => ({
            stream: rs.stream, // On passe le flux brut tel quel
            metadata: {
                fromName: rs.metadata?.fromName || 'Unknown',
                roomId: rs.metadata?.room,
                countViewers: apiInstance.usersInRoom?.value?.length || apiInstance.usersInRoom?.length || 0,
                currentType: rs.remoteType,
                peerId: rs.peerId || rs.metadata?.peerId || null, // On vérifie les deux emplacements au cas où
                isAudioMuted: rs.metadata?.isAudioMuted ?? false,
                isVideoEnabled: rs.metadata?.isVideoEnabled ?? false,
            }
        }))
    })

    const remoteScreensData = computed(() =>
        props.api.remoteScreens.value.map(rs => ({
            stream: rs.stream,
            metadata: {
                fromName: rs.metadata?.fromName || rs.remoteSlug || 'Unknown',
                roomId: rs.metadata?.room,
                countViewers: props.api.usersInRoom.value.length,
                currentType: 'screen',
            }
        }))
    )
</script>