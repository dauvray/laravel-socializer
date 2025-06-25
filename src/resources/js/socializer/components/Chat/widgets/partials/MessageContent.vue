<template>
    <div class="message-inner" >
        <div v-if="hasFiles" class="files">
            <JoinedFiles 
                v-for="(file, idx) in item.extras.files" 
                :key="idx"
                :file="file"
                :conversationId="conversationId"
                @show-file="onShowFile"
            ></JoinedFiles>
        </div>
        <AudioPlayer v-if="isAudio" :src="`/chat/file/${conversationId}/${item.extras.audio.filename}`"></AudioPlayer>
        <div v-if="hasMessage" class="message" v-html="item.message"></div>
        <small v-if="isEdited" class="ps-2"><i>Modifié</i></small>
    </div>
</template>

<script>
    import { defineAsyncComponent } from '@vue/runtime-core'

    export default {
        name: 'MessageContent',
        emits: [
            'show-file',
        ],
        props: {
            item: {
                type: Object,
                required: true
            },
            conversationId: {
                type: String,
                required: true
            },
        },
        components: {
            AudioPlayer: defineAsyncComponent(() => import('~estarter/components/widgets/AudioPlayer.vue')),
            JoinedFiles: defineAsyncComponent(() => import('./JoinedFiles.vue')),
        },
        computed: {
            hasFiles: function() {
                if(!this.item.hasOwnProperty('extras')) return false
                return this.item.extras.hasOwnProperty('files') && this.item.extras.files
            },
            isAudio: function() {
                if(!this.item.hasOwnProperty('extras')) return false
                return this.item.extras.hasOwnProperty('audio') && this.item.extras.audio !== null
            },
            hasMessage: function() {
                return this.item.hasOwnProperty('message') && this.item.message
            },
            isEdited:function() {
                if(!this.item.hasOwnProperty('extras')) return false
                if(!this.item.extras.hasOwnProperty('edited')) return false
                return this.item.extras.edited === 1
            },
        },
        methods: {
            onShowFile(file) {
                this.$emit('show-file', file)
            },
        },
    }
</script>