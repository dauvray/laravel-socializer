<template>
    <div v-if="props.status !== 'idle'" id="call-web-ui">
        <template v-if="props.status === 'calling' || props.status === 'receiving'">
            <Spinner></Spinner>
        </template>
        <template v-else>
            <button
                type="button"
                :class="{ 'btn-toggle-on': !props.isMuted }"
                @click="emit('toggle-audio')">
                <IconWidget v-if="props.isMuted" icon="microphone" title="activer le son"></IconWidget>
                <IconWidget v-else icon="microphone-slash" title="couper le son"></IconWidget>
            </button>
            <button
                type="button"
                :class="{ 'btn-toggle-on': props.isVideoEnabled }"
                @click="emit('toggle-video')">
                <IconWidget v-if="!props.isVideoEnabled" icon="video" title="activer la caméra"></IconWidget>
                <IconWidget v-else icon="video-slash" title="couper la caméra"></IconWidget>
            </button>
            <button
                type="button"
                class="btn-stop-call"
                @click="emit('stop-call')">
                <IconWidget icon="phone-slash" title="raccrocher"></IconWidget>
            </button>
        </template>
    </div>
</template>

<script setup>
    /**
     * Barre de commande d'un appel en cours : couper son micro, couper sa caméra, raccrocher.
     *
     * Purement présentationnel, comme `LocalStreamBtn` : aucun état local, aucun store. Il rend
     * l'état que son parent lui passe et lui redemande une action. L'adaptateur est
     * `System/Notifications.vue`, qui détient l'API de `useMediaBroadcast` — même partage que
     * `LocalStreamBtn` (présentation) / `GroupLocalStreamBtn` (adaptateur).
     *
     * ⚠️ Les deux bascules ont longtemps été DEUX BOUTONS MORTS : ni `@click`, ni binding, et des
     * icônes littérales figées. Le défaut n'était pas seulement qu'ils ne faisaient rien — les
     * deux canaux de rendu se contredisaient en permanence. Sous la convention du voisin
     * (« l'icône dit l'action à venir »), `microphone-slash` annonce « couper le son », donc un
     * micro OUVERT ; mais `#call-web-ui button { @extend .btn-secondary; }` est précisément la
     * classe que `LocalStreamBtn` réserve à l'état COUPÉ. Câblés le 2026-08-31 (lot F), et
     * épinglés par `CallManagerBtn.test.js` — dont quatre contrôles séparent, sur chaque
     * bascule, l'icône de la classe : ce sont deux rendus indépendants du même drapeau, aux
     * conditions inversées.
     *
     * ⚠️ Le `v-if` de la racine n'est PAS redondant avec celui du parent, et les deux ne gardent
     * pas la même chose. Celui-ci est le contrat du composant : `status` n'est pas `required`,
     * donc un montage sans état est possible, et sans cette garde il rendrait trois boutons de
     * commande — dont « raccrocher » — hors de tout appel. Celui de `Notifications.vue:14` garde
     * autre chose : le chargement paresseux du chunk, ce composant y étant un
     * `defineAsyncComponent`.
     *
     * ⚠️ `btn-toggle-on` est une classe MAISON, et c'est une question de spécificité, pas de
     * goût : `#call-web-ui button` vaut (1,0,1) et écraserait un `class="btn-primary"` posé ici,
     * à (0,1,0) — l'état actif serait invisible. Le motif de contournement était déjà dans le
     * fichier, `.btn-stop-call` à (1,1,0). La règle vit dans les DEUX copies de
     * `_socializer.scss` (paquet et hôte), et c'est celle de l'hôte qui est compilée.
     *
     * ℹ️ Ce que ce composant NE fait pas, et qui n'est pas un oubli : annoncer la bascule aux
     * pairs. `GroupLocalStreamBtn` le fait par `sendData({ type: 'AUDIO_MUTE_TOGGLE' })`, ce qui
     * est hors de portée ici — un appel 1-à-1 n'ouvre aucune connexion de données
     * (`usePeerConnections.js` n'appelle `peer.connect()` que sur la branche `stream`). La
     * moitié utile fonctionne quand même sans signalisation : `toggleAudioState` pose
     * `track.enabled = false` sur le flux local, donc le pair d'en face entend du silence
     * immédiatement. L'absence d'annonce — donc de badge « micro coupé » chez le pair — est un
     * item ouvert de `work/webrtc2-todo.md`.
     */
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import Spinner from '~estarter/components/widgets/Spinners/Spinner1.vue'

    const props = defineProps({
        status: {
            type: String,
            default: 'idle'
        },
        // Les deux défauts sont ceux du contexte réel (`createPeerContext.js:152-153`) :
        // micro ouvert, caméra active.
        isMuted: {
            type: Boolean,
            default: false
        },
        isVideoEnabled: {
            type: Boolean,
            default: true
        }
    })

    // Kebab-case, la convention de ce fichier — et non le snake_case de `LocalStreamBtn`, qui
    // est le sien et n'a pas à se propager.
    const emit = defineEmits(['stop-call', 'toggle-audio', 'toggle-video'])
</script>
