<template>
    <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isInCall || !busPret"
        :title="`Appel ${typeAppel}`"
        @click="onCallUser">
        <IconWidget :icon="callIcon"></IconWidget>
    </button>
</template>

<script setup>
    /**
     * Bouton d'appel du mur d'un utilisateur.
     *
     * Il ne parle à personne directement : il pose une invitation sur l'eventBus global, s'arme,
     * et attend un `close-call` qui le nomme pour se rendre à l'utilisateur. Son unique
     * consommateur de production est `User/Cover.vue`, qui ne lui passe JAMAIS de `type` — le
     * défaut `'visio'` est donc le chemin réel.
     *
     * ⚠️ Les deux `inject` sont traités DIFFÉREMMENT, et ce n'est pas une incohérence : c'est la
     * différence entre un ornement et une dépendance.
     *
     * ⚠️ L'armement est OPTIMISTE et n'est pas réconcilié : rien ne le relâche sinon un
     * `close-call`. Le lot F a fermé le chemin qui n'en émettait aucun (l'invitation non émise,
     * côté `useCallManager`), et la garde de slug ci-dessous ferme le second. Il reste que ce
     * bouton croit son propre clic — épinglé par `CallRemotePeerBtn.test.js`, § « armé, il ne
     * renvoie plus rien ».
     */

    import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { isValidSlug, normalizeDirectCallType } from '~socializer/components/WebRTC2/Composables/utils/validators.js'

    const props = defineProps({
        user: {
            type: Object,
            required: true
        },
        type: {
            type: String,
            default: 'visio'
        }
    })

    // Optionnel par contrat, comme `GroupLocalStreamBtn.vue:44` : les sous-apps montées par
    // `createApp()` dans `usePeerMedia` ne fournissent pas `AWN`, et l'absence y est normale.
    // ⚠️ Ce défaut `null` n'évite AUCUN plantage à lui seul (mesuré au lot B : un inject nu rend
    // `undefined` et le repli marche pareil) — il n'évite qu'un « injection "AWN" not found ».
    // Ce qui compte vraiment ici est l'appel OPTIONNEL plus bas : avant, `AWN.info` levait entre
    // l'émission de l'invitation et l'écriture de l'état, donc sur une page sans notifieur
    // l'invitation partait et le bouton restait ACTIF — renvoyable en boucle, la `TypeError`
    // étant avalée par `callWithErrorHandling` de Vue.
    const AWN = inject('AWN', null)

    // L'eventBus, lui, n'est PAS optionnel : c'est la fonctionnalité. `onCallUser` n'a aucun
    // autre canal, et un no-op silencieux — le geste juste pour un CONTEXTE
    // (`createPeerContext.js:95-102`) — produirait ici un bouton qui accepte le clic, se
    // désactive et n'envoie rien. C'est exactement ce que son consommateur condamne :
    // « un bouton qui ne fait rien est pire que pas de bouton » (`Cover.vue:29-32`).
    // Donc il l'avoue : il se désactive, et le dit UNE fois — au setup, pas à chaque clic.
    const eventBus = inject('eventBus', null)

    // Le même prédicat que `createPeerContext.js:96` : les TROIS méthodes. Un objet qui n'aurait
    // que `$emit` passerait une garde de présence et casserait au `$on` du montage, loin de sa
    // cause.
    const busPret = typeof eventBus?.$emit === 'function'
        && typeof eventBus?.$on === 'function'
        && typeof eventBus?.$off === 'function'

    if (!busPret) {
        console.error(
            '[CallRemotePeerBtn] eventBus non fourni ou invalide — le bouton d\'appel est'
            + ' désactivé plutôt que muet.',
        )
    }

    const isInCall = ref(false)

    // Normalisé à la source : le titre, l'icône et l'invitation disent tous les trois la même
    // chose. `isValidCallType` ne convient pas — il accepte aussi `data`/`stream`/`screen`, et
    // un `type` non normalisé devenait un cul-de-sac en aval (cf. `validators.js`).
    const typeAppel = computed(() => normalizeDirectCallType(props.type))

    const callIcon = computed(() => {
        if(typeAppel.value === 'vocal') {
            return isInCall.value ? 'phone-slash' : 'phone'
        }
        return isInCall.value ? 'video-slash' : 'video'
    })

    const onCloseCall = (users) => {
        if (!Array.isArray(users) || users.length === 0) return
        const shouldReset = users.some((user) => {
            if (!user || user.userSlug !== props.user.slug) return false

            // Une entrée sans `type` vaut `visio`, comme partout ailleurs dans la chaîne.
            // Avant, elle remettait à zéro QUEL QUE SOIT le type du bouton — une tolérance
            // qu'aucun des quatre émetteurs n'exerce (`useCallManager.js:490`,
            // `Notifications.vue` refus / abandon / raccrocher : tous portent un `type`).
            return normalizeDirectCallType(user.type) === typeAppel.value
        })

        if (shouldReset) {
            isInCall.value = false
        }
    }

    const onCallUser = () => {
        if (!busPret) return

        // Sans cette garde, un `user` sans slug émettait `('call-user', undefined, …)` —
        // rejeté en silence par `isValidSlug` en aval — ET armait le bouton quand même : un
        // bouton définitivement mort pour un appel qui n'a jamais existé.
        if (!isValidSlug(props.user?.slug)) {
            console.error('[CallRemotePeerBtn] `user.slug` absent ou invalide — appel non émis.')
            return
        }

        eventBus.$emit('call-user', props.user.slug, typeAppel.value)
        // L'état AVANT le toast : l'armement ne doit pas dépendre du succès d'un appel
        // cosmétique. Un notifieur qui lève laissait l'invitation partie et le bouton actif.
        isInCall.value = true

        const notifieur = AWN ?? window.AWN
        try {
            notifieur?.info(`Appel ${props.user.slug}`)
        } catch {
            // Un toaster qui lève ne doit pas défaire un appel déjà parti.
        }
    }

    onMounted(() => {
        if (busPret) {
            eventBus.$on('close-call', onCloseCall)
        }
    })

    onBeforeUnmount(() => {
        if (busPret) {
            eventBus.$off('close-call', onCloseCall)
        }
    })
</script>
