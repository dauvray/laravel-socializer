<template>
    <template v-if="!callInprogress">

        <template v-if="!isStreaming">
            <div class="btn-group btn-group-sm" role="group">
                <button
                    class="btn btn-sm btn-primary dropdown-toggle"
                    type="button"
                    data-bs-toggle="dropdown"
                    aria-expanded="false">
                    <IconWidget icon="broadcast-tower" /> Streaming
                </button>

                <ul class="dropdown-menu">
                    <li>
                        <a
                            class="dropdown-item"
                            href="#"
                            @click.prevent="onVideoCall">
                            <IconWidget icon="video" />
                            Stream vidéo
                        </a>
                    </li>

                    <li>
                        <a
                            class="dropdown-item"
                            href="#"
                            @click.prevent="onAudioCall">
                            <IconWidget icon="phone" />
                            Stream audio
                        </a>
                    </li>
                </ul>
            </div>
        </template>

        <template v-else>
            <button
                type="button"
                id="stop-stream-btn"
                class="btn btn-sm btn-danger"
                @click="onStopBrodcastWebcam"
            >
                <IconWidget icon="window-close" />
                Terminer stream
            </button>

            <button
                type="button"
                class="btn btn-sm"
                :class="[isMuted ? 'btn-secondary' : 'btn-primary']"
                @click="onManageAudio"
            >
                <IconWidget
                    v-if="isMuted"
                    icon="microphone"
                    title="activer le son"
                />

                <IconWidget
                    v-else
                    icon="microphone-slash"
                    title="couper le son"
                />
            </button>

            <button
                v-if="isVideoCall"
                type="button"
                class="btn btn-sm"
                :class="[isVideoEnabled ? 'btn-primary' : 'btn-secondary']"
                @click="onManageVideo"
            >
                <IconWidget
                    v-if="!isVideoEnabled"
                    icon="video"
                    title="activer la caméra"
                />

                <IconWidget
                    v-else
                    icon="video-slash"
                    title="couper la caméra"
                />
            </button>
        </template>

    </template>
</template>

<script>
import IconWidget from '~estarter/components/widgets/IconWidget.vue'

export default {
    name: 'StreamDefaultUserButtonUI',
    components: {
        IconWidget,
    },
    props: {
        isStreaming: Boolean,
        callInprogress: Boolean,
        isMuted: Boolean,
        isVideoEnabled: Boolean,
        isVideoCall: Boolean,
        isAudioCall: Boolean,

        onVideoCall: Function,
        onAudioCall: Function,
        onManageAudio: Function,
        onManageVideo: Function,
        onStopBrodcastWebcam: Function,
    },
}
</script>