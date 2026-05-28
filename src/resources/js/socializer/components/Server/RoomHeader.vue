<template>
    <section :style="backgroundStyle">
        <h1 v-if="currentRoom">{{ currentRoom.name }}</h1>
        <slot name="tools"></slot>
    </section>
</template>

<script setup>

    import { computed } from 'vue'
    import { storeToRefs } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'

    defineOptions({ name: 'RoomHeader' })

    const serverStore = useServerStore()
    const { getCurrentRoom: currentRoom } = storeToRefs(serverStore)

    const cover = computed(() => {
        if (currentRoom.value && currentRoom.value.image && currentRoom.value.image.length) {
            const c = currentRoom.value.image[0]
            return `/serve-thumbnail/${c.name}/large/${c.preview}`
        }
    })

    const backgroundStyle = computed(() => {
        return cover.value
            ? { backgroundImage: `url(${cover.value})`, backgroundSize: 'cover' }
            : {}
    })
</script>
