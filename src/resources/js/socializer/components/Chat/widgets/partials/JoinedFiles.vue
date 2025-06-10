<template>
    <img v-if="isImage"
         :alt="file.name"
         class="rounded"
         :src="`/chat/file/${conversationId}/${file.filename}`"
         style="max-width: 100%; max-height: 300px; object-fit: cover;"
         @click="onShownModal">

   <div class="m-2" v-else>
        <FileIcon 
            :mime-type="file.mime"
            class="m-2"
        ></FileIcon>
        <a :href="`/chat/file/${conversationId}/${file.filename}`" download>{{ file.name }}</a>
        <span v-if="file.size">
            ({{ (file.size / 1024).toFixed(2) }} Ko)
        </span>
    </div> 
    <ModalWidget
        v-if="showModal"
        :target="`Modal${uid}`"
        :trigger="showModal"
        :showBtn="false"
        @hide="onHideModal"
    ></ModalWidget>
</template>

<script>
    import FileIcon from '~formdesigner/application/formCreator/widgets/atoms/FileIcon.vue'
    import { defineAsyncComponent } from '@vue/runtime-core'
    import { uniqueId } from '~estarter/services/helpers.js'

    export default {
        name: 'JoinedFiles',
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
            FileIcon,
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/Modal.vue')),
        },
        data() {
            return {
                showModal: false,
                uid: uniqueId(),
            };
        },
        computed: {
            isImage: function() {
                return this.file.mime.startsWith('image/');
            },
            onShownModal() {
                this.showModal = true;
            },
            onHideModal() {
                this.showModal = false;
            }
        }
    };
</script>