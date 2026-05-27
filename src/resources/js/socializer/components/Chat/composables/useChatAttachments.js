/**
 * useChatAttachments — fichiers joints au message en cours de rédaction.
 *
 * Gère la liste locale des pièces jointes affichée par `UploadFilesTable`
 * et alimentée par `TextareaMessage` (events `@file-added` / `@file-removed`).
 *
 * À noter : `onRemoveFile(fileId)` reste dans le composant car il croise la ref
 * de template `messengerInput` (il délègue au composant enfant la suppression
 * réelle, qui ré-émet ensuite `file-removed` → `removeFromList`).
 */
import { ref } from 'vue'

export function useChatAttachments() {

    // Pièces jointes du message en cours : { id, data, preview, ... }
    const attachedFiles = ref([])

    // Ajout depuis TextareaMessage : on génère un aperçu objectURL.
    const onFileAdded = (file) => {
        file.preview = URL.createObjectURL(file.data)
        attachedFiles.value.push(file)
    }

    // Retrait de la liste locale (suite à l'event `file-removed`).
    const removeFromList = (file) => {
        attachedFiles.value = attachedFiles.value.filter(f => f.id !== file.id)
    }

    // Reset après envoi du message.
    const clear = () => {
        attachedFiles.value = []
    }

    return {
        attachedFiles,
        onFileAdded,
        removeFromList,
        clear,
    }
}
