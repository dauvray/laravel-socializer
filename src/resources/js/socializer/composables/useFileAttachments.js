/**
 * useFileAttachments — liste réactive de fichiers joints, avec aperçus.
 *
 * Générique : gère une liste locale de pièces jointes (add/remove/clear) et
 * génère un aperçu objectURL par fichier. Aucun couplage au chat — réutilisable
 * par tout formulaire avec upload de fichiers.
 *
 * Gère la liste locale des pièces jointes affichée par `UploadFilesTable`
 * et alimentée par `TextareaMessage` (events `@file-added` / `@file-removed`).
 *
 * À noter : `onRemoveFile(fileId)` reste dans le composant car il croise la ref
 * de template `messengerInput` (il délègue au composant enfant la suppression
 * réelle, qui ré-émet ensuite `file-removed` → `removeFromList`).
 */
import { ref } from 'vue'

export function useFileAttachments() {

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
