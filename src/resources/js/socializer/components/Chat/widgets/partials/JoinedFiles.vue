<template>
    <img v-if="isImage" :alt="file.name"
        class="rounded"
        :src="thumbnailUrl"
        style="max-width: 100%; max-height: 300px; object-fit: cover;"
        @click="onShowFile"
    />
    <div class="m-2" v-else>
        <FileIcon 
            :mime-type="file.mime"
            class="m-2"
        ></FileIcon>
        <a :href="fileUrl" download>{{ file.name }}</a>
        <span v-if="file.size">
            ({{ (file.size / 1024).toFixed(2) }} Ko)
        </span>
    </div> 
</template>

<script>

    import { defineAsyncComponent } from '@vue/runtime-core'
    import { uniqueId } from '~estarter/services/helpers.js'

    export default {
        name: 'JoinedFiles',
        emits: [
            'show-file',
        ],
        props: {
            file: {
                type: Object,
                required: true,
            },
            conversationId: {
                type: String,
                required: true,
            },
        },
        components: {
            FileIcon: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/atoms/FileIcon.vue')),
        },
        data() {
            return {
                uid: uniqueId(),
            };
        },
        computed: {
            isImage: function() {
                return this.file.mime.startsWith('image/');
            },
            fileUrl: function() {
                return `/chat/file/${this.conversationId}/${this.file.filename}`
            },
            thumbnailUrl: function() {
                return `/serve-thumbnail/${this.file.thumbnail}/large` || this.fileUrl;
            },
        },
        methods: {
            onShowFile: function() {
                this.$emit('show-file', this.fileUrl);
            },
        },
    }
</script>