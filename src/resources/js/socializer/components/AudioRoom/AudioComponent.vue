<template>
    <!-- <Teleport :to="`#collapser-${room.id}`" >
        <SpectrumAnalyzer
            v-if="currentStream"
            class="border rounded mt-2"
            :streams="streams"
        ></SpectrumAnalyzer>
    </Teleport> -->

    <Teleport to="#room-header-tools">
        <MediaBroadcastProvider
            :users="users"
            :room="room.id"
            v-slot="stream"
            ><AudioDefaultUserButtonUI v-bind="stream" />
        </MediaBroadcastProvider>
    </Teleport>

    <div class="chat-header m-2">
        <RoomUsersList :users="users"></RoomUsersList>
    </div>
</template>

<script>

   // import SpectrumAnalyzer from './widgets/SpectrumAnalyzer.vue'
    import RoomUsersList from '~socializer/components/Server/widgets/RoomUsersList.vue'
    import MediaBroadcastProvider from '~socializer/components/WebRTC/widgets/MediaBroadcastProvider.vue'
    import AudioDefaultUserButtonUI from '~socializer/components/WebRTC/widgets/ui/AudioDefaultUserButtonUI.vue'

    
    export default {
        name: 'AudioComponent',
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
           // SpectrumAnalyzer,
            RoomUsersList,
            MediaBroadcastProvider,
            AudioDefaultUserButtonUI,
        },
    }
</script>

