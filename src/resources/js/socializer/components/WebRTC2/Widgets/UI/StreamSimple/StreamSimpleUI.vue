<template>
    <div class="card">
        <div class="card-body">
            <div class="btn-group btn-group-sm" role="group">
                <LocalStreamBtn
                    :isStreaming="props.api.isStreaming.value"
                    :streamStates="props.api.streamStates.value"
                    @start_video="startWebcamStream"
                    @start_audio="startAudioStream"
                    @stop_video="stopWebcamStream"
                    @stop_audio="stopAudioStream"
                    @toggle_audio="onToggleAudioMute"
                    @toggle_video="onToggleVideoVisibility"
                ></LocalStreamBtn>
                <LocalCaptureBtn
                    :isCapturing="props.api.isCapturing.value"
                    @start-stream="startScreenCapture"
                    @stop-stream="stopScreenCapture">
                </LocalCaptureBtn>
            </div>       
            <div class="row">
                <div class="col">
                    <h5>Local Stream</h5>
                </div>
                <div class="col">
                    <h5>Remote Streams</h5>
                </div>
            </div>
            <div class="row">
                <div class="col">
                    <VideoComponent v-if="props.api.currentStream.value" :streamData="localStreamData"></VideoComponent>
                    <VideoComponent v-if="props.api.screenStream.value" :streamData="screenStreamData"></VideoComponent>
                </div>
                <div class="col">
                    <VideoComponent v-for="(remoteStream, index) in remoteStreamsData" 
                        :key="index" 
                        :streamData="remoteStream" 
                    ></VideoComponent>
                    <VideoComponent v-for="(remoteScreen, index) in remoteScreensData" 
                        :key="index" 
                        :streamData="remoteScreen"
                    ></VideoComponent>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
    import { ref, computed, watch, onMounted } from 'vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import VideoComponent from '~socializer/components/WebRTC2/Widgets/VideoComponent.vue' 
    import LocalStreamBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalStreamBtn.vue'
    import LocalCaptureBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalCaptureBtn.vue'

    const props = defineProps({
        api: Object,
    })

    const meStore = useMeStore()

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
    // signalData.value.push({data, peerdId: conn?.metadata?.peerId})
    }

    /**
     * Methodes de contrôle des flux locaux (webcam + audio) et de partage d’écran
     */

    const startWebcamStream = () => {
        props.api.getWebcamStream()
    }

    const stopWebcamStream = () => {
        props.api.stopStream()
    }

    const startAudioStream = () => {
        props.api.getAudioStream()
    }

    const stopAudioStream = () => {
        props.api.stopAudio()
    }

    const startScreenCapture = () => {
        props.api.startCapture()
    }

    const stopScreenCapture = () => {
        props.api.stopCapture()
    }

    const onToggleAudioMute = () => {
        props.api.toggleAudioMute()
        props.api.sendData('hello from audio stream')
    }

    const onToggleVideoVisibility = () => {
        props.api.toggleVideoVisibility()
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