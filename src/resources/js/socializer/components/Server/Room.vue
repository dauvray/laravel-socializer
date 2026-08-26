<template>
    <div v-if="currentRoom"
        class="room-wrapper">
        <div id="room-navigation"></div>

        <!-- une room peut contenir plusieurs pages donc ici navigation 
         mais l'ajout d'un chat dans chaque room à changé la donne 
         ( TODO : a refacto et a déplacer ailleurs ) -->
        <!-- <Teleport :to="`#collapser-${currentRoom.id}`" >
            <ul class="list-group list-group-flush">
                <li class="list-group-item" v-for="(content, index) in roomContent"  >
                    <router-link 
                        :to="{ name: content.content_type, params: { vertexId: content.id }}" 
                        class="room-name">
                        <button  type="button">{{ content.name }}</button>
                    </router-link>
                </li>
            </ul>
        </Teleport> -->

        <div class="room-content-layout">
            <div class="room-content-main">
                <router-view
                    v-if="!roomLocked"
                    :editable="isOwner"
                    :users="users"
                    :room="currentRoom"
                ></router-view>
                <LockedRoom v-else></LockedRoom>
            </div>

            <ChatComponent
                v-if="roomChatVisible"
                ref="chat"
                class="room-chat"
                :style="{ width: `${chatWidth}px` }"
                v-resizable-width="{
                    min: 400,
                    max: 800,
                    handle: 'left',
                    callback: updateChatWidth
                }"
                :vertexId="currentConversationId"
                :displayUsers="false"
                :autoload="false"
            ></ChatComponent>
        </div>

    </div>
</template>

<script setup>
    // VUE & LIBS
    import { ref, computed, watch, onBeforeUnmount, defineAsyncComponent } from 'vue'
    import { storeToRefs } from 'pinia'
    import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router'

    // STORES
    import { useServerStore } from '~socializer/stores/server.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { useChatStore } from '~socializer/stores/chat.js'

    // COMPOSABLES
    import { useBreadcrumbService } from '~estarter/services/BreadcrumbService.js'
    import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

    // UTILS & DIRECTIVES
    import vResizableWidth from '~socializer/directives/resizable_width.js'

    // COMPOSANTS ASYNCHRONES
    const LockedRoom = defineAsyncComponent(() => import('./widgets/LockedRoom.vue'))
    const ChatComponent = defineAsyncComponent(() => import('~socializer/components/Chat/ChatComponent.vue'))

    const emit = defineEmits([
        'update-users-room',
        'joining-user-room',
        'leaving-user-room',
    ])

    const route = useRoute()
    const router = useRouter()
    const breadcrumbService = useBreadcrumbService()

    const serverStore = useServerStore()
    const chatStore = useChatStore()
    const meStore = useMeStore()

    const {
        getCurrentRoom: currentRoom,
        getOwnerId: ownerId,
        // utilisé par le <Teleport> commenté du template — à réactiver avec la navigation multi-pages d'une room
        getCurrentRoomContent: roomContent,
        getRoomChatVisible: roomChatVisible,
    } = storeToRefs(serverStore)
    const { getCurrentConversationId: currentConversationId } = storeToRefs(chatStore)
    const { getMe } = storeToRefs(meStore)
    const { loadRoom, resetCurrentRoom } = serverStore

    const roomLocked = ref(false)
    const chatWidth = ref(420)
    const isChatVisible = ref(false)
    const chat = ref(null)

    const channelName = computed(() => {
        if (currentRoom.value) {
            return `room.${currentRoom.value.id}`
        }
        return null
    })

    const meChannelName = computed(() => getMe.value?.channel ?? null)

    const isOwner = computed(() => ownerId.value === getMe.value.vertexid)

    /**
     * L'entrée `content` du fil d'Ariane s'écrit APRÈS la confirmation de la navigation, jamais
     * depuis une garde : le watcher `$route` de l'`App.vue` du projet hôte reconstruit tout le
     * tableau depuis `route.meta.breadcrumb` à chaque changement de route, donc une écriture faite
     * avant est écrasée. C'est ce qui laissait l'entrée vide — et ce qui donnait l'illusion qu'un
     * second clic « réparait » le fil d'Ariane : ce second clic ne navigue pas, donc rien ne vient
     * plus écraser l'écriture.
     */
    const onUpdateBreadcrumb = () => {
        if (!currentRoom.value) {
            return
        }

        breadcrumbService.updateBreadcrumb({
            name: currentRoom.value.name,
            id: 'content',
            link: null,
        })
    }

    /** Cible du contenu par défaut du salon **chargé**, ou `undefined` s'il n'en a aucun. */
    const defaultContentLocation = () => {
        const defaultContent = currentRoom.value?.content?.[0]

        if (!defaultContent) {
            return undefined
        }

        return { name: defaultContent.content_type, params: { vertexId: defaultContent.id } }
    }

    const loadDefaultContent = () => {
        const location = defaultContentLocation()

        if (location) {
            router.push(location)
        }
    }

    const updateChatWidth = (newWidth) => {
        chatWidth.value = newWidth
    }

    watch(currentRoom, (newRoom) => {
        if (newRoom && newRoom.hasOwnProperty('content_type') && newRoom.content_type === 'locked') {
            roomLocked.value = true
        }
    })

    /**
     * Une URL de salon sans contenu (`…/room/{id}`) doit ouvrir le contenu par défaut du salon.
     * Deux règles, chacune payée par un bug :
     *
     * 1. **On RETOURNE la cible, on ne la pousse pas.** `router.push()` depuis une garde écrase le
     *    `pendingLocation` du routeur : la navigation en vol meurt en `NAVIGATION_CANCELLED`, et
     *    `RouterLink` avale l'échec (`.catch(noop)`) — le clic reste sans effet ET sans erreur.
     * 2. **Un salon différent passe sans redirection.** Tant que la navigation n'est pas confirmée,
     *    `currentRoom` porte encore l'ANCIEN salon : rediriger ici renvoyait vers le contenu du
     *    salon qu'on quitte, donc on ne pouvait plus changer de salon sans repasser par l'accueil
     *    du serveur. Le `<router-view :key="$route.params.roomId">` de `Server.vue` remonte ce
     *    composant, et c'est `initRoom()` qui charge le nouveau salon puis son contenu.
     */
    onBeforeRouteUpdate((to, from) => {
        if (to.params.vertexId || to.params.roomId !== from.params.roomId) {
            return
        }

        return defaultContentLocation()
    })

    watch(route, () => {
        onUpdateBreadcrumb()
    })

    // S'exécute avant les leave() auto enregistrés par les useReverbChannel ci-dessous.
    onBeforeUnmount(() => {
        whisperMe('leave-room', {
            userId: getMe.value.id,
            roomId: currentRoom.value.id,
        })
        resetCurrentRoom()
    })

    const { whisper: whisperMe } = useReverbChannel(meChannelName, {
        type: 'private',
    })

    const { users } = useReverbChannel(channelName, {
        type: 'presence',
        onJoining: (user) => emit('joining-user-room', user),
        onLeaving: (user) => emit('leaving-user-room', user),
        onError: (err) => console.error(err),
    })

    watch(users, (val) => {
        emit('update-users-room', val)
    })

    const initRoom = async () => {
        await loadRoom(route.params.roomId)
        loadDefaultContent()
        onUpdateBreadcrumb()
    }
    initRoom()
</script>