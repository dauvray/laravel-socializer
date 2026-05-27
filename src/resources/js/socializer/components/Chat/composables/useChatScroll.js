/**
 * useChatScroll — gestion du défilement de la liste des messages.
 *
 * Responsabilités portées à l'identique depuis ChatComponent.vue :
 *  - `scrollView`            : amène le bas de la liste dans la vue (smooth).
 *  - `waitImagesAndScroll`   : attend le chargement des images avant de scroller
 *                              (auto-scroll au montage et à chaque nouveau message).
 *  - `onTriggerObserver`     : pagination infinie (scroll vers le haut), avec
 *                              compensation de la position pour éviter le saut.
 *
 * Le composable possède les refs de template `messageContainer` /
 * `messageContainerInner` : on les ré-assigne aux mêmes noms dans le composant
 * pour ne pas toucher le `<template>`.
 *
 * ⚠️ Comportements sensibles conservés tels quels (NE PAS « améliorer ») :
 *  - les `setTimeout(1000)` du watch(messages) et de l'onMounted ;
 *  - le calcul de `scrollTop` à la pagination.
 *
 * @param {Object}   deps
 * @param {Ref}      deps.messages          - liste réactive des messages
 * @param {Ref}      deps.nextPageUrl       - URL de la page suivante (ou null)
 * @param {Function} deps.loadConversation  - (id, url) => Promise, charge une page
 */
import { ref, onMounted, watch } from 'vue'

export function useChatScroll({ messages, nextPageUrl, loadConversation } = {}) {

    // Refs de template (mêmes noms que dans le composant)
    const messageContainer = ref(null)
    const messageContainerInner = ref(null)

    function scrollView() {
        const el = messageContainerInner.value
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'end' })
        }
    }

    function waitImagesAndScroll(is_new_message = false) {

        const el = messageContainerInner.value
        if (!el) return

        const images = is_new_message ? el.querySelectorAll('lastMessage') : el.querySelectorAll('img')

        const total = images.length
        if (total === 0) {
            scrollView()
            return
        }

        let loaded = 0
        const checkDone = () => {
            loaded++

            if (loaded === total) {
                scrollView()
            }
        }

        images.forEach(img => {
            if (img.complete) {
                checkDone()
            } else {
                img.addEventListener('load', checkDone, { once: true })
                img.addEventListener('error', checkDone, { once: true }) // au cas où une image échoue
            }
        })
    }

    function onTriggerObserver() {
        if(nextPageUrl.value) {
            const container = messageContainer.value
            const previousScrollHeight = container.scrollHeight

            loadConversation(null, nextPageUrl.value).then(() => {
                const newScrollHeight = container.scrollHeight
                container.scrollTop += newScrollHeight - previousScrollHeight
            })
        }
    }

    /*------ WATCHERS ----------*/
    watch(messages, () => {
        setTimeout(()=> {
            waitImagesAndScroll(true)
        }, 1000)
    })

    /*------ LIFECYCLE ----------*/
    onMounted(() => {
        setTimeout(()=> {
            waitImagesAndScroll()
        },1000)
    })

    return {
        messageContainer,
        messageContainerInner,
        scrollView,
        waitImagesAndScroll,
        onTriggerObserver,
    }
}
