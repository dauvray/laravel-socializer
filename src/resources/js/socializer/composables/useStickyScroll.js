/**
 * useStickyScroll — défilement « collé en bas » d'une liste paginée.
 *
 * Générique : convient à toute liste/feed qui grandit en bas et pagine en
 * haut (chat, notifications, logs…). Aucun couplage au chat ; les dépendances
 * passées (`messages`, `nextPageUrl`, `loadConversation`) sont quelconques.
 *
 * API exposée :
 *  - `scrollToBottomIfStuck` : scroll bas seulement si l'utilisateur y est collé
 *                              (appelé par le composant à la réception d'un message).
 *  - `scrollToBottom`        : saut bas explicite (bouton « nouveaux messages »).
 *  - `waitImagesAndScroll`   : attend le chargement des images avant de scroller.
 *  - `onTriggerObserver`     : pagination infinie (scroll vers le haut), avec
 *                              compensation de la position pour éviter le saut.
 *  - `stickToBottom`         : l'auto-scroll suit-il le bas de la liste ?
 *  - `hasNewMessages`        : message reçu pendant que l'utilisateur est remonté.
 *
 * Le composable possède les refs de template `messageContainer` /
 * `messageContainerInner` : on les ré-assigne aux mêmes noms dans le composant
 * pour ne pas toucher le `<template>`.
 *
 * Comportement « stick-to-bottom » : l'auto-scroll ne suit le bas que si
 * l'utilisateur y est (à NEAR_BOTTOM_PX près). Dès qu'il remonte lire
 * l'historique, l'auto-scroll se coupe ; il se réarme au retour en bas ou après
 * IDLE_REENABLE_MS sans scroller. Un message reçu pendant la lecture active
 * `hasNewMessages` (bouton) au lieu de ramener l'utilisateur en bas.
 *
 * ⚠️ Comportements sensibles conservés tels quels (NE PAS « améliorer ») :
 *  - les `setTimeout(1000)` du watch(messages) et de l'onMounted ;
 *  - le calcul de `scrollTop` à la pagination.
 *
 * Correctif UX : le watch(messages) ne déclenche l'auto-scroll bas que pour un
 * ajout en FIN de liste (dernier id changé). Sans ce garde, la pagination
 * (préprend en tête) ramenait l'utilisateur vers le bas après ~1 s.
 *
 * @param {Object}   deps
 * @param {Ref}      deps.messages          - liste réactive des messages
 * @param {Ref}      deps.nextPageUrl       - URL de la page suivante (ou null)
 * @param {Function} deps.loadConversation  - (id, url) => Promise, charge une page
 */
import { ref, onMounted, onUnmounted, watch } from 'vue'

// Tolérance (px) sous laquelle on considère l'utilisateur « collé en bas ».
const NEAR_BOTTOM_PX = 120
// Délai d'inactivité de scroll après lequel on réarme l'auto-scroll.
const IDLE_REENABLE_MS = 20000

export function useStickyScroll({ messages, nextPageUrl, loadConversation } = {}) {

    // Refs de template (mêmes noms que dans le composant)
    const messageContainer = ref(null)
    const messageContainerInner = ref(null)

    // Auto-scroll « stick-to-bottom » : actif tant que l'utilisateur est en bas.
    // Se désactive dès qu'il remonte lire l'historique ; se réarme au retour en
    // bas ou après IDLE_REENABLE_MS sans scroller.
    const stickToBottom = ref(true)
    // Vrai quand un message arrive en fin de liste alors que l'utilisateur est
    // remonté : pilote l'affichage du bouton « nouveaux messages ».
    const hasNewMessages = ref(false)
    let idleTimer = null

    function distanceFromBottom() {
        const el = messageContainer.value
        if (!el) return 0
        return el.scrollHeight - el.scrollTop - el.clientHeight
    }

    function onScroll() {
        const nearBottom = distanceFromBottom() <= NEAR_BOTTOM_PX
        stickToBottom.value = nearBottom

        // De retour en bas : on a vu les nouveaux messages, le bouton disparaît.
        if (nearBottom) hasNewMessages.value = false

        clearTimeout(idleTimer)
        // Remonté dans l'historique : on réarme après un temps sans scroller.
        if (!nearBottom) {
            idleTimer = setTimeout(() => { stickToBottom.value = true }, IDLE_REENABLE_MS)
        }
    }

    // Saut explicite en bas (clic sur le bouton « nouveaux messages »).
    function scrollToBottom() {
        stickToBottom.value = true
        hasNewMessages.value = false
        scrollView()
    }

    function scrollView() {
        const el = messageContainerInner.value
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'end' })
        }
    }

    // Scroll vers le bas seulement si l'utilisateur y est déjà « collé ».
    // Utilisé par le composant à la réception d'un message.
    function scrollToBottomIfStuck() {
        if (stickToBottom.value) scrollView()
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
    // Auto-scroll vers le bas UNIQUEMENT quand un message est ajouté en fin de
    // liste (envoi / réception). Sur une pagination (préprend de messages anciens
    // en tête), on ne scrolle pas : la position est déjà compensée par
    // `onTriggerObserver`, sinon le watch ramènerait l'utilisateur vers le bas.
    watch(messages, (newMessages, oldMessages) => {
        const newLastId = newMessages?.[newMessages.length - 1]?.id
        const oldLastId = oldMessages?.[oldMessages.length - 1]?.id
        if (!newLastId || newLastId === oldLastId) return

        // L'utilisateur lit l'historique plus haut : on ne le ramène pas en bas,
        // on signale juste un nouveau message (affiche le bouton).
        if (!stickToBottom.value) {
            hasNewMessages.value = true
            return
        }

        setTimeout(()=> {
            waitImagesAndScroll(true)
        }, 1000)
    })

    /*------ LIFECYCLE ----------*/
    onMounted(() => {
        messageContainer.value?.addEventListener('scroll', onScroll, { passive: true })
        setTimeout(()=> {
            waitImagesAndScroll()
        },1000)
    })

    onUnmounted(() => {
        clearTimeout(idleTimer)
        messageContainer.value?.removeEventListener('scroll', onScroll)
    })

    return {
        messageContainer,
        messageContainerInner,
        scrollToBottomIfStuck,
        scrollToBottom,
        waitImagesAndScroll,
        onTriggerObserver,
        stickToBottom,
        hasNewMessages,
    }
}
