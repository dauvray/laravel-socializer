<template>
    <div class="card">
        <div class="card-body">
            <ul>
                <li>
                    Room : {{ api.onAirRoom }}
                </li>
                <li>
                    Type : {{ api.currentType }}
                </li>
                <li>
                    Remote users : {{ api.remotePeers }}
                    <ul>
                        <li>
                            Présence synchronisée :
                            <span :class="stateClass(api.presenceSynced?.value)">{{ api.presenceSynced }}</span>
                            <em v-if="api.presenceSynced?.value === false">
                                — « je ne sais pas encore », pas « personne »
                            </em>
                        </li>
                    </ul>
                </li>
                <li>
                    Topology : {{ api.topology }}
                    <template v-if="api.topology.value === 'star'">
                        <ul>
                            <li>
                                Hub Slug : {{ api.hubSlug }}
                            </li>
                            <li>
                                I'm local Hub : <span :class="stateClass(api.isHub.value)">{{ api.isHub }}</span>
                            </li>
                            <li>
                                Hub Connected : <span :class="stateClass(api.isHubConnected.value)">{{ api.isHubConnected }}</span>
                            </li>
                        </ul>
                    </template>
                </li>
                <template v-if="api.currentType.value !== 'data'">
                    <li>
                        Streaming : <span :class="stateClass(api.isStreaming.value)">{{ api.isStreaming }}</span>
                        <ul v-if="api.isStreaming.value">
                            <li>
                                Video : <span :class="stateClass(api.isVideoEnabled.value)">{{  api.isVideoEnabled }}</span>
                            </li>
                            <li>
                                Audio : <span :class="stateClass(!api.isMuted.value)">{{ !api.isMuted.value }}</span>
                            </li>
                        </ul>
                    </li>
                    <li>
                        Capturing : <span :class="stateClass(api.isCapturing.value)">{{ api.isCapturing }}</span>
                    </li>
                    <li>
                        Flux annoncés, pas encore reçus : {{ api.announcedStreamPeers }}
                    </li>
                </template>

                <!--
                    Signalisation et transport. Sans ces lignes, « B ne voit rien » se lit
                    de la même façon qu'on ait un peerId périmé, une demande étranglée ou
                    un appel jamais répondu — trois pannes distinctes, un seul symptôme.
                -->
                <li>
                    Mon peerId : <code>{{ api.localPeerId?.value ?? '—' }}</code>
                </li>
                <li>
                    peerId connus (onglet) :
                    <ul>
                        <li v-for="entry in remotePeerIds" :key="entry.slug">
                            {{ entry.slug }} → <code>{{ entry.peerId }}</code>
                            <span :class="stateClass(entry.ageMs < REMOTE_PEER_ID_LEASE_MS)">
                                (bail {{ entry.ageMs }} ms)
                            </span>
                        </li>
                        <li v-if="!remotePeerIds.length"><em>aucun</em></li>
                    </ul>
                </li>
                <li>
                    Demandes de peerId en vol (ce contexte) :
                    <ul>
                        <li v-for="entry in pendingRequests" :key="entry.key">
                            {{ entry.slug }} · {{ entry.type }} · {{ entry.ageMs }} ms
                        </li>
                        <li v-if="!pendingRequests.length"><em>aucune</em></li>
                    </ul>
                </li>
                <li>
                    Connexions :
                    <ul>
                        <li v-for="entry in connections" :key="entry.key">
                            {{ entry.slug }} · {{ entry.type }} —
                            <span :class="stateClass(entry.established)">
                                {{ entry.established ? 'établie' : entry.state }}
                            </span>
                        </li>
                        <li v-if="!connections.length"><em>aucune</em></li>
                    </ul>
                </li>
            </ul>
        </div>
    </div>
</template>

<script setup>
    /**
     * Debug.vue — Ce que le contexte SAIT, à l'instant t.
     *
     * Panneau de lecture pure : aucune logique métier, aucune écriture. Il existe parce
     * que les pannes de ce module se ressemblent toutes vues de l'utilisateur (« je ne
     * vois rien ») alors qu'elles ont des causes disjointes — présence pas encore connue,
     * peerId périmé, demande étranglée, appel ouvert mais jamais répondu. Les distinguer
     * demandait jusqu'ici d'instrumenter le code à la main.
     *
     * ⚠️ Le store est lu directement, et non via `api` : ces faits appartiennent à
     * l'ONGLET (un seul `Peer`, un seul store pour N contextes), pas au contexte. Les
     * faire transiter par l'API de diffusion laisserait croire l'inverse.
     */
    import { computed } from 'vue'
    import { usePeer2Store } from '~socializer/stores/peers2.js'
    import { REMOTE_PEER_ID_LEASE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

    const props = defineProps({
        api: Object,
    })

    const peerStore = usePeer2Store()

    const stateClass = (ok) => (ok ? 'text-success' : 'text-danger')

    const _room = computed(() => props.api?.currentCallRoomId?.value || props.api?.onAirRoom?.value)

    /**
     * Mapping slug → peerId : partagé par tout l'onglet, d'où l'absence de filtre.
     *
     * `ageMs` est l'âge du bail (`REMOTE_PEER_ID_LEASE_MS`) : au-delà, on ne compose plus
     * sur cette entrée, on redemande la signalisation. C'est l'information qui manquait
     * pour diagnostiquer un « Could not connect to peer <uuid> » — comme pour
     * `pendingRequests`, l'âge ne se rafraîchit qu'au changement de la Map.
     */
    const remotePeerIds = computed(() =>
        [...(peerStore.remotePeersId?.entries?.() ?? [])].map(([slug, entry]) => ({
            slug,
            peerId: entry?.peerId,
            ageMs: Date.now() - (entry?.learnedAt ?? Date.now()),
        }))
    )

    /** Demandes émises par CE contexte et encore sans réponse. */
    const pendingRequests = computed(() => {
        const contextId = props.api?.contextId
        return [...(peerStore.waitingRemotePeerId?.entries?.() ?? [])]
            .filter(([, entry]) => entry?.contextId === contextId)
            .map(([key, entry]) => ({
                key,
                slug: entry?.userSlug ?? '?',
                type: entry?.type ?? '?',
                ageMs: Date.now() - (entry?.createdAt ?? Date.now()),
            }))
    })

    /**
     * Connexions de la room courante, avec l'état qui compte.
     *
     * « établie » suit le même critère que le moteur de retry (`isConnectionEstablished`) :
     * `open` pour un canal data, `connected` pour un appel média. Un appel affiché
     * `connecting` est un appel dont l'offre est partie et que PERSONNE n'a répondu — il
     * ne changera jamais d'état tout seul.
     */
    const connections = computed(() => {
        const byRoom = peerStore.getConnections?.[_room.value] ?? {}
        const rows = []

        Object.entries(byRoom).forEach(([slug, byType]) => {
            Object.entries(byType ?? {}).forEach(([type, list]) => {
                (list ?? []).forEach((conn, index) => {
                    const isMedia = conn?.type === 'media'
                        || (conn?.type !== 'data' && typeof conn?.answer === 'function')
                    const state = isMedia
                        ? (conn?.peerConnection?.connectionState ?? 'inconnu')
                        : (conn?.open ? 'open' : 'closed')

                    rows.push({
                        key: `${slug}|${type}|${index}`,
                        slug,
                        type,
                        state,
                        established: isMedia ? state === 'connected' : conn?.open === true,
                    })
                })
            })
        })

        return rows
    })
</script>
