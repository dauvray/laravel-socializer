<template>
    <div :style="backgroundStyle">
        <h1 v-if="currentRoom">{{ currentRoom.name }}</h1>
    </div>
</template>

<script>

    import { mapState } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'

    export default {
        name: 'RoomHeader',
        computed: {
            ...mapState(useServerStore, {
                currentRoom: 'getCurrentRoom',
            }),
            cover: function() {
                if(this.currentRoom && this.currentRoom.image && this.currentRoom.image.length) {
                    const cover = this.currentRoom.image[0]
                    return `/serve-thumbnail/${cover.name}/large/${cover.preview}`
                }
            },
            backgroundStyle() {
                return this.cover
                    ? { backgroundImage: `url(${this.cover})`, backgroundSize: 'cover' }
                    : {};
            }
        }
    }
</script>
