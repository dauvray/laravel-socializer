<template>
    <component
        v-if="currentComponent"
        v-draggable
        :is="currentComponent"
        :fromUserSlug="fromUserSlug"
        :options="options"
        @response-alert="onResponseAlert"
    ></component>
</template>

<script>
    import { defineAsyncComponent } from 'vue'
    import Draggable from '~socializer/directives/draggable.js'
    import { ALERT_LOAD_TIMEOUT_MS, missedCallMessage } from '~socializer/components/System/system.config.js'

    /**
     * Ce que Vue rend à la place d'une alerte dont le chunk ne se charge pas — rejeté (un onglet
     * ouvert avant un déploiement, typiquement) ou pendu au-delà d'`ALERT_LOAD_TIMEOUT_MS` : elle se
     * refuse dès son montage, par le `response-alert` d'un clic sur « Refuser », et prévient l'appelé.
     * L'écouteur et `fromUserSlug` lui arrivent par les attributs transmis du wrapper asynchrone.
     *
     * ⚠️ Sans elle, le wrapper en échec ne rendait rien et restait monté : ni sonnerie ni minuteur
     * d'auto-refus (ils naissent dans le `mounted()` de l'alerte), aucune réponse à l'appelant, et
     * le créneau de `Notifications` pris pour la vie de l'onglet.
     *
     * ⚠️ Ne couvre que le CHARGEMENT. Une exception dans le `data()` d'une alerte — non enveloppé par
     * Vue, en dev comme en prod — l'empêche de monter sans passer par ici, et garde le créneau. Aucun
     * chemin réaliste aujourd'hui (seul `new Audio(url)` y est, et il ne lève pas) : rien de fragile
     * dans le `data()` des deux alertes.
     */
    const CallAlertUnavailable = {
        name: 'CallAlertUnavailable',
        props: ['error', 'fromUserSlug'],
        emits: ['response-alert'],
        mounted() {
            console.warn('[AlertComponent] alerte d\'appel introuvable — invitation refusée d\'office', this.error)
            window.AWN?.info(missedCallMessage(this.fromUserSlug), { durations: { info: 0 } })
            this.$emit('response-alert', false)
        },
        render: () => null,
    }

    const asyncCallAlert = (loader) => defineAsyncComponent({
        loader,
        errorComponent: CallAlertUnavailable,
        timeout: ALERT_LOAD_TIMEOUT_MS,
    })

    export default {
        name: 'AlertComponent',
        emits: [
            'response-alert'
        ],
        components: {
            AudioCallAlert: asyncCallAlert(() => import('~socializer/components/WebRTC2/Widgets/UI/Alerts/AudioCallAlert.vue')),
            VideoCallAlert: asyncCallAlert(() => import('~socializer/components/WebRTC2/Widgets/UI/Alerts/VideoCallAlert.vue')),
        },
        props: {
            fromUserSlug: {
                type: String,
                required: false,
                default: null
            },
            options: {
                type: Object,
                required: true
            }
        },
        directives: {
            draggable: Draggable,
        },
        data() {
            return {
                currentComponent: null,
                mappingComponents: {
                    'peer-access-permission' : {
                        'vocal': 'AudioCallAlert',
                        'visio': 'VideoCallAlert'
                    }
                }
            }
        },
        /**
         * Choisit l'alerte, et se refuse d'office quand aucune ne sait afficher l'invitation.
         *
         * ⚠️ Ne rien afficher ne suffit pas : `Notifications` tient le créneau d'alerte tant
         * qu'aucune réponse ne remonte, et refuse d'office tout autre appelant pendant ce temps.
         * Une alerte invisible et muette le garderait pour toujours. Le refus le libère, et dit à
         * l'appelant tout de suite ce que l'abandon de son retry ne lui aurait dit qu'à la fin. Le
         * même geste couvre l'alerte qui ne PEUT pas s'afficher, son chunk ne se chargeant pas :
         * `CallAlertUnavailable`, plus haut.
         */
        created() {
            this.currentComponent = this.mappingComponents[this.options.action]?.[this.options.type]

            if (!this.currentComponent) {
                console.warn(
                    `[AlertComponent] invitation non affichable (action « ${this.options.action} »,` +
                    ` type « ${this.options.type} ») — refusée d'office`
                )
                this.onResponseAlert(false)
            }
        },
        methods: {
            onResponseAlert(status) {
                this.$emit('response-alert', this.fromUserSlug, this.options, status)
            }
        }
    }
</script>