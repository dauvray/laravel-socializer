<template>
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
                <a class="dropdown-item"
                    href="#"
                    @click.prevent="onStartVideoCall">
                    <IconWidget icon="video" /> Stream vidéo
                </a>
            </li>
            <li>
                <a class="dropdown-item"
                    href="#"
                    @click.prevent="onStartAudioCall">
                    <IconWidget icon="phone" /> Stream audio
                </a>
            </li>
        </ul>
    </div>
</template>

<script setup>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    const onStartVideoCall = () => {
        // Emit an event to start a video call
        // You can replace this with your actual implementation
        console.log('Starting video call...')
    }

    const onStartAudioCall = () => {
        // Emit an event to start an audio call
        // You can replace this with your actual implementation
        console.log('Starting audio call...')
    }

</script>