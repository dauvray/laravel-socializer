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
        <a class="color-auto" :href="fileUrl" download>
            <IconWidget icon="download"></IconWidget> {{ file.name }}
        </a>
        <span v-if="file.size">
            ( {{ fileSize }} )
        </span>
    </div> 
</template>

<script>

    import { defineAsyncComponent } from '@vue/runtime-core'
    import { uniqueId, formatFileSize } from '~estarter/services/helpers.js'

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
            IconWidget: defineAsyncComponent(() => import('~estarter/components/widgets/IconWidget.vue')),
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
            fileSize: function() {
                return formatFileSize(this.file.size)
            },
            thumbnailUrl: function() {
                return this.file.thumbnail || this.fileUrl;
            },
        },
        methods: {
            onShowFile: function() {
                this.$emit('show-file', this.fileUrl, this.file.mime);
            },
        },
    }
</script>