import { ref, computed, onMounted } from 'vue'
import { useApplicationStore } from '~estarter/stores/application.js'

export function useStatusUsersObserver(observable = 'body', property = 'users-status', className = 'status-online') {

    /*******************************
     * INITIALISATION
     * *****************************/
    const applicationStore = useApplicationStore()

    const observer = ref(null)
    const mutationObserver = ref(null)

    /*******************************
     * METHODS
     * *****************************/

    const InitOnlineStatusObserver = () => {

        observer.value = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {

                const slugUser = entry.target.dataset.slug
                const statusUser = entry.target.dataset.status

                if (entry.isIntersecting) {

                    if(!statusListeners.value.hasOwnProperty(slugUser)) {
                        applicationStore.addCustomisationValue(`${property}.${slugUser}`, {
                                status : statusUser
                        })
                        startListeningToUserStatus(slugUser)
                    }

                }
            },
            {
                threshold: 0, // La callback est appelée même si 1 pixel est visible
            })
        })

        // MutationObserver pour détecter les nouveaux éléments ajoutés
        mutationObserver.value = new MutationObserver((mutations) => { 
            mutations.forEach((mutation) => {

                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => { 

                        traverseNodes(node, (addeddNode) => {
                            if (addeddNode.classList && addeddNode.classList.contains(className)) {
                                const slugUser = addeddNode.dataset.slug
                                observeNewElement(addeddNode)
                            }
                        })

                    })
                }

                mutation.removedNodes.forEach((node) => {

                    traverseNodes(node, (removedNode) => {
                        if (removedNode.classList && removedNode.classList.contains(className)) {
                            const slugUser = removedNode.dataset.slug
                            observer.value.unobserve(removedNode)
                            applicationStore.removeCustomisationValue(`${property}.${slugUser}`)
                            stopListeningToUserStatus(slugUser)
                        }
                    })

                })

            })
        })

        // Observer un conteneur pour détecter les ajouts d'enfants
        const container = document.querySelector(observable)
        mutationObserver.value.observe(container, { 
            childList: true, 
            subtree: true 
        })

        document.querySelectorAll(`.${className}`).forEach((element) => {
            observeNewElement(element)
        })
    }

    const observeNewElement = (element) => {
        if (!element._isObserved) {
            observer.value.observe(element)
            element._isObserved = true
        }
    }

    // Fonction récursive pour parcourir les nœuds supprimés
    const traverseNodes = (node, callback) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            callback(node) // Appelle le callback pour ce nœud
        }
        node.childNodes.forEach((child) => traverseNodes(child, callback)) // Parcours des sous-nœuds
    }

    const startListeningToUserStatus = (slugUser) => {
        Echo.leave(`user-status.${slugUser}`)
        Echo.channel(`user-status.${slugUser}`)
             .listen('.userStatusUpdated', (event) => {
                // Met à jour le statut dans le store
                applicationStore.addCustomisationValue(`${property}.${event.slug}.status`, event.status)
        })
    }

    const stopListeningToUserStatus = (slugUser) => {
        Echo.leave(`user-status.${slugUser}`)
    }

    /*******************************
     * COMPUTED
     * *****************************/

    const statusListeners = computed(() => {
        return applicationStore.getCustomisationValue(property, {})
    })

    /*******************************
     * LIFE CYCLE
     * *****************************/

    onMounted(() => {
        setTimeout(() => {
            InitOnlineStatusObserver()
        }, 5000) 
    })

    return {
        InitOnlineStatusObserver,
    }

}