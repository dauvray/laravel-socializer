<template>
    <table class="table table-sm" v-if="attachedFiles.length">
        <tbody>
            <tr class="file-item" v-for="file in attachedFiles" :key="file.id">
                <th scope="row">1</th>
                <td>{{ file.name }}</td>
                <td>{{ getFormatedFileSize(file.size) }}</td>
                <td><FilePreview :file="file"></FilePreview></td>
                <td><button class="btn" @click="onRemoveFile(file.id)">❌</button></td>
            </tr>
        </tbody>
    </table>
</template>

<script>
    import { formatFileSize } from '~estarter/services/helpers.js'
    import FilePreview from "~formdesigner/application/formCreator/widgets/atoms/FilePreview.vue"

    export default {
        name: 'UploadFilesTable',
        emits: ['remove-file'],
        components: {
            FilePreview
        },
        props: {
            attachedFiles: {
                type: Array,
                required: true
            }
        },
        methods: {
            getFormatedFileSize(size) {
                return formatFileSize(size)
            },
            onRemoveFile(fileId) {
                this.$emit('remove-file', fileId);
            }
        }
    };
</script>