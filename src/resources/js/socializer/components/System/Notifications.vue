<template>
    <Teleport to="body">
        <div id="videoContainer"></div>
        <!--
            `:key` = l'invitation : une alerte par invitation, donc un type et un minuteur
            d'auto-refus par invitation. Sans lui, le rappel d'un compte dont l'alerte sonnait
            encore PATCHAIT l'instance vivante, et le minuteur de la première refusait le rappel.
            Les relances réutilisent leur inviteId (éliminées avant par `isInviteDuplicate`) ;
            une invitation sans inviteId garde l'ancien patch.
        -->
        <component
            id="notification-component-wrapper"
            v-if="notificationComponent"
            :key="notificationComponentProps?.options?.inviteId"
            :is="notificationComponent"
            v-bind="notificationComponentProps"
            @response-alert="onResponseAlert"
        ></component>
    </Teleport>

    <CallManagerBtn
        v-if="callStatus !== 'idle'"
        :status="callStatus"
        :isMuted="isMuted"
        :isVideoEnabled="isVideoEnabled"
        @stop-call="onStopCall"
        @toggle-audio="onToggleAudioMute"
        @toggle-video="onToggleVideoVisibility"
    ></CallManagerBtn>

    <ToasterNewMessage
        v-if="NewMessageNotification"
        :event="NewMessageNotification"
        @closed="NewMessageNotification = null"
    ></ToasterNewMessage>
</template>

<script setup>
// VUE & LIBS
import { ref, shallowRef, computed, watch, onMounted, onUnmounted, inject, defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'

// STORES
import { useMeStore } from '~estarter/stores/me.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useConversationsStore } from '~socializer/stores/conversations.js'

// COMPOSABLES
import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

// CONFIG
import { ALERT_LOAD_TIMEOUT_MS, missedCallMessage } from '~socializer/components/System/system.config.js'

// COMPOSANTS ASYNCHRONES

/**
 * Ce que Vue rend à la place d'`AlertComponent` quand son chunk ne se charge pas — rejeté (un onglet
 * ouvert avant un déploiement, typiquement) ou pendu au-delà d'`ALERT_LOAD_TIMEOUT_MS` : un refus
 * immédiat, par le `response-alert` qu'émettrait l'alerte, et un toast qui prévient l'appelé.
 *
 * ⚠️ Sans lui, le wrapper en échec ne rendait rien et restait monté, `notificationComponent` restait
 * non nul, et le garde « occupé » refusait tous les appelants suivants pour la vie de l'onglet — avec
 * un toast parlant d'un appel que personne ne voyait. Le refus vide le créneau, et le montage suivant
 * retente l'import.
 */
const AlertComponentUnavailable = {
    name: 'AlertComponentUnavailable',
    props: ['error', 'fromUserSlug', 'options'],
    emits: ['response-alert'],
    mounted() {
        console.warn('[Notifications] alerte introuvable — invitation refusée d\'office', this.error)
        window.AWN?.info(missedCallMessage(this.fromUserSlug), { durations: { info: 0 } })
        this.$emit('response-alert', this.fromUserSlug, this.options, false)
    },
    render: () => null,
}

const AlertComponent = defineAsyncComponent({
    loader: () => import('~socializer/components/System/widgets/AlertComponent.vue'),
    errorComponent: AlertComponentUnavailable,
    timeout: ALERT_LOAD_TIMEOUT_MS,
})
const CallManagerBtn = defineAsyncComponent(() =>import('~socializer/components/WebRTC2/Widgets/UI/Buttons/CallManagerBtn.vue'))
const ToasterNewMessage = defineAsyncComponent(() =>import('~socializer/components/System/widgets/ToasterNewMessage.vue'))

// Inject
const eventBus = inject('eventBus')

// Stores
const meStore = useMeStore()
const peerStore = usePeer2Store()
const conversationsStore = useConversationsStore()

// On garde la réactivité des getters avec storeToRefs
const { getMe: me } = storeToRefs(meStore)
// Actions : destructuration directe (pas besoin de storeToRefs)
const { addUnreadNotifications } = meStore
const { dispatchSignal } = peerStore
const { addConversation } = conversationsStore

// Composable
const peers = useMediaBroadcast()

// State local
// `shallowRef` : il porte un COMPOSANT, qu'un `ref` profond envelopperait dans un proxy réactif.
const notificationComponent = shallowRef(null)
const notificationComponentProps = ref(null)
const NewMessageNotification = ref(null)
const heartbeatIntervalId = ref(null)

// Computed
const userChannel = computed(() => me.value?.channel)
const callStatus = computed(() => peers.callStatus())

// Les deux états de piste que `CallManagerBtn` rend. Ce composant est l'adaptateur de la barre
// de commande, comme `GroupLocalStreamBtn` l'est du panneau de diffusion.
const isMuted = computed(() => peers.isMuted.value)
const isVideoEnabled = computed(() => peers.isVideoEnabled.value)

const { whisper: whisperPing } = useReverbChannel(userChannel, {
    type: 'private',
    // Laravel notifications
    onNotification: () => {
        addUnreadNotifications(1)
    },
    listeners: {
        // display alerts to user
        '.AlertToUser': async (event) => {
            if (peers.isInviteDuplicate(event?.options?.inviteId)) return

            // Occupé ⇒ refus. Réaffecter le même composant ne le remonterait pas : Vue patcherait
            // l'alerte vivante, qui garderait son type et son minuteur d'auto-refus, et ce
            // minuteur refuserait le second appelant à la place du premier.
            if (isAwaitingAnotherCaller(event)) {
                window.AWN?.info(`Appel de ${event.fromUserSlug} refusé : un autre appel arrivait déjà`)
                await respondToInvitation(event.fromUserSlug, event.options, false)
                return
            }

            notificationComponentProps.value = event
            notificationComponent.value = AlertComponent
        },

        // connect to caller user and send localPeerId
        '.AskToPeerID': (event) => {
            dispatchSignal({
                emitter: 'Notifications',
                roomId: `${event.type}-${event.room}`,
                type: 'PEER_CONNECTION_REQUEST',
                payload: event,
            })
        },

        // receive remotePeerId and connect to called user
        '.ResponseToPeerID': (event) => {
            dispatchSignal({
                emitter: 'Notifications',
                roomId: `${event.type}-${event.room}`,
                type: 'PEER_CONNECT_TO_REMOTE_PEER',
                payload: event,
            })
        },

        // receive authorization to peer connection
        '.ResponseToAuthorizationPeer': async (event) => {
            // ⚠️ Pas d'arrêt de la relance ICI : c'est `openCallBetweenPeer` qui décide si la
            // réponse vaut pour l'invitation en vol, et qui l'arrête quand elle vaut. Arrêtée
            // avant sa garde, une réponse que la garde ignore ensuite ne laissait ni relance ni
            // abandon — l'appelant restait en `calling` pour toujours.

            if (!event.status) {
                window.AWN.info(`${event.fromUserSlug} est injoignable`)
                eventBus.$emit('close-call', [
                    { userSlug: event.fromUserSlug, type: event?.options?.type || 'visio' },
                ])
            }

            // ⚠️ Appelé AUSSI sur refus, et surtout pas derrière un `return` : la branche
            // `!status` d'`openCallBetweenPeer` est la SEULE qui retire le participant et
            // ramène la FSM à IDLE (CALLING → CLOSING → IDLE) quand il était le dernier.
            // Ni le toast ni `close-call` ne touchent à l'état d'appel — le `return` qui
            // était ici laissait donc `callStatus` bloqué sur 'calling' après un refus,
            // y compris l'auto-refus de VideoCallAlert au bout de 10 s sans réponse : le
            // spinner de CallManagerBtn restait affiché jusqu'au rechargement de la page.
            await peers.openCallBetweenPeer({
                ...event,
                options: { ...event.options },
            })
        },

        '.CloseConnectionToPeerID': (event) => {
            peers.remoteStopCall(event)
        },

        '.ChatInvitation': (event) => {
            addConversation(event)
            // `window.AWN`, comme ses deux voisines (le refus `.ResponseToAuthorizationPeer` et
            // l'abandon `inviteAbandonedSignal`) : un
            // `AWN` nu était un identifiant NON DÉCLARÉ — ni `const`, ni `inject` — donc un
            // `ReferenceError` en module ESM, toujours strict. Plus difficile à diagnostiquer
            // qu'un `TypeError` : la trace ne nomme pas le toaster, elle nomme une variable
            // inconnue. Trouvé le 2026-08-31 en cadrant le lot F.
            window.AWN?.info('Vous avez été invité dans une nouvelle conversation', {
                durations: { info: 0 },
            })
        },

        '.NewChatMessageNotification': (event) => {
            NewMessageNotification.value = event
        },

        // Eventbus for components
        '.EventBusNotification': (event) => {
            eventBus.$emit(event.type, event.payload)
        },
    },
})

// Watchers
// ⚠️ Enregistré APRÈS le composable, et c'est ce qui fait partir le ping d'ouverture de session.
// `me` est null au montage (loadMe() est asynchrone, et ce composant n'attend pas), donc la
// transition null → valeur a toujours lieu et les deux watchers y réagissent dans leur ordre de
// création. Au-dessus de l'appel, setOnlineStatus() courrait avant le join() : whisper() rendrait
// false, et l'utilisateur resterait hors ligne jusqu'au battement suivant — deux minutes, soit
// exactement le TTL Redis de la présence.
watch(me, (value) => {
    if (value) setOnlineStatus()
})

// L'invitation n'a jamais reçu de réponse : le destinataire n'a aucun onglet ouvert, donc
// aucun `.ResponseToAuthorizationPeer` n'arrivera — jamais. L'abandon du moteur de retry est
// le seul événement disponible, et on en rejoue le chemin du refus : c'est la même issue,
// sans le signal distant pour l'annoncer.
watch(() => peers.inviteAbandonedSignal.value, async (abandoned) => {
    if (!abandoned) return

    // Consommé AVANT l'await : un second abandon doit pouvoir repasser par ici.
    peers.inviteAbandonedSignal.value = null

    const { userSlug } = abandoned
    const type = abandoned.type || 'visio'

    window.AWN.info(`${userSlug} n'a pas répondu`)
    eventBus.$emit('close-call', [{ userSlug, type }])

    // ⚠️ Comme sur un refus : seule la branche `!status` d'`openCallBetweenPeer` retire le
    // participant et ramène la FSM à IDLE. Ni le toast ni `close-call` n'y touchent.
    await peers.openCallBetweenPeer({
        fromUserSlug: userSlug,
        status: false,
        options: { type },
    })
})

// Méthodes

/**
 * Une alerte attend-elle déjà la réponse d'un AUTRE appelant ?
 *
 * ⚠️ La comparaison d'appelant n'est pas une politesse. Une relance du moteur de retry réutilise
 * son `inviteId`, et `isInviteDuplicate` l'élimine avant ce garde ; ce qui lui échappe et vient du
 * MÊME compte est un client sans `inviteId` (le serveur l'accepte `nullable`), ou un second onglet ou
 * appareil, qui appelle avec un id neuf. Refuser celui-là partirait sur le canal de l'appelant, donc
 * vers tous ses onglets, et y couperait l'appel qui sonne ici quand l'onglet appelant ne sait pas
 * reconnaître son invitation : un refus SANS `inviteId` garde l'ancien sens, « ce pair refuse
 * l'appel en cours » (`useCallManager._consumeRefusedInvitation`), et c'est ce qu'émettent un client
 * sans `inviteId` et tout bundle antérieur au 27/10/2026. Le même compte n'est donc pas refusé : son
 * invitation REMPLACE l'alerte — remontée, et non patchée, par le `:key` du template, donc avec son
 * propre type et son propre minuteur.
 *
 * Ce que ça coûte, et c'est assumé : l'invitation remplacée ne reçoit AUCUNE réponse. Entre deux
 * bundles à jour, la réponse finale porte l'`inviteId` du remplaçant, et l'onglet appelant le plus
 * ancien l'ignore — il attend l'abandon de son moteur de retry, ≈55 s après son invitation. Avant,
 * le même refus les coupait tous les deux. Borne écrite dans `flux.md`. `fromUserSlug` est posé par
 * le serveur depuis l'utilisateur authentifié : il ne se forge pas.
 */
function isAwaitingAnotherCaller(event) {
    return notificationComponent.value !== null
        && notificationComponentProps.value?.fromUserSlug !== event?.fromUserSlug
}

async function onResponseAlert(fromUserSlug, options, status) {
    notificationComponent.value = null
    await respondToInvitation(fromUserSlug, options, status)
}

/** Le verbe qui répond à une invitation, qu'elle vienne d'une alerte ou d'un refus d'office. */
async function respondToInvitation(fromUserSlug, options, status) {
    switch (options.action) {
        case 'peer-access-permission':
            await peers.acceptCallFromPeer({
                fromUserSlug,
                options: { ...options },
                status,
            })
            break
        default:
            break
    }
}

function setOnlineStatus() {
    if (!me.value) return
    whisperPing('ping', {
        timestamp: Date.now(),
        userId: me.value.id,
    })
}

/**
 * Coupe / rouvre son micro pendant un appel.
 *
 * ⚠️ Pas de `sendData` ici, contrairement à `GroupLocalStreamBtn.onToggleAudioMute` — et ce
 * n'est pas un oubli. Un appel 1-à-1 n'a AUCUNE connexion de données : `usePeerConnections`
 * n'appelle `peer.connect()` que sur la branche `stream`, jamais sur `visio`/`vocal`. Et
 * `sendData` lit `onAirRoom`, figé à `'app'` dans ce contexte, alors que les connexions
 * d'appel sont rangées sous `currentCallRoomId`. L'appeler ne ferait qu'écrire un
 * « connexion indisponible » en console à chaque clic.
 *
 * Ce qui marche quand même, et c'est la moitié utile : `toggleAudioState` pose
 * `track.enabled = false` sur le flux local, donc le pair d'en face entend du silence
 * immédiatement. Ce qui manque est seulement le badge « micro coupé » de son côté — item
 * ouvert de `work/webrtc2-todo.md`.
 */
function onToggleAudioMute() {
    peers.toggleAudioMute()
}

/** Coupe / rouvre sa caméra pendant un appel. Même borne que ci-dessus sur l'annonce. */
function onToggleVideoVisibility() {
    peers.toggleVideoVisibility()
}

async function onStopCall() {
    const currentUsers = peers.currentCallUsers?.value ?? []
    const usersToStop = [...currentUsers]
    eventBus.$emit('close-call', usersToStop)
    await peers.stopCallWithPeers(usersToStop)
}

/**
 * Émet l'invitation demandée par un bouton d'appel, et rejoue le chemin du refus si elle ne
 * part pas.
 *
 * ⚠️ Ce troisième chemin d'échec n'était fermé nulle part, et c'est le plus grave des trois :
 * `startCallWithPeer` engage la FSM en CALLING **avant** de savoir si l'invitation peut partir,
 * et son aval refuse d'émettre quand il n'y a pas de peerId local publiable. La FSM restait
 * alors en CALLING pour la vie de l'onglet — spinner sans bouton raccrocher, et plus aucun
 * appel possible vers qui que ce soit. Le moteur remet désormais la FSM à IDLE et rend `null` ;
 * ici on ajoute ce que seul cet étage peut faire : le dire à l'utilisateur, et réarmer les
 * boutons d'appel des murs. Les mêmes deux gestes que le refus (`.ResponseToAuthorizationPeer`) et
 * l'abandon (`inviteAbandonedSignal`).
 */
async function onStartCall(toUserSlug, type) {
    const inviteId = await peers.startCallWithPeer({ toUserSlug, type })

    if (inviteId) return

    const callType = type || 'visio'

    window.AWN?.info(`Appel vers ${toUserSlug} impossible pour l'instant`)

    // ⚠️ Le garde n'est pas décoratif : `startCallWithPeer` refuse AUSSI quand un appel est
    // déjà en cours — y compris avec ce pair-là. Émettre `close-call` sans vérifier
    // réarmerait son bouton PENDANT l'appel.
    const dejaParticipant = (peers.currentCallUsers?.value ?? [])
        .some((user) => user.userSlug === toUserSlug)

    if (!dejaParticipant) {
        eventBus.$emit('close-call', [{ userSlug: toUserSlug, type: callType }])
    }
}

// Lifecycle
onMounted(() => {
    peers.initialize({
        onStreamReceived: peers.handleStreamReceived,
        onConnectionClose: peers.handleStreamRemoved,
    })

    eventBus.$on('call-user', onStartCall)

    heartbeatIntervalId.value = setInterval(() => {
        setOnlineStatus()
    }, 120000) // toutes les 2 minutes
})

onUnmounted(async () => {
    try {
        const currentUsers = peers.currentCallUsers?.value ?? []
        if (currentUsers.length > 0 || peers.isCallInProgress()) {
            await peers.stopCallWithPeers([...currentUsers], false)
        }
    } finally {
        // Le canal privé personnel est libéré au compteur par useReverbChannel : pas d'Echo.leave()
        // ici, il couperait les autres composants qui le tiennent encore.
        eventBus.$off('call-user', onStartCall)

        peers.clearAllCallInviteRetries()
        peers.clearSeenInvites()

        clearInterval(heartbeatIntervalId.value)
        heartbeatIntervalId.value = null
    }
})
</script>
