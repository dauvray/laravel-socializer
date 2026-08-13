<template>
    <!--
        Hôte du pool de players.

        Une seule app Vue rend TOUS les flux : ajouter ou retirer un flux devient
        une mutation du tableau `slots`, au lieu d'un createApp/mount/unmount par flux.

        ⚠️ La clé du v-for est `slot.key` — l'identité du SLOT, pas celle du flux.
        C'est ce qui rend le pool effectif : libérer un flux (`slot.videoId = null`)
        ne démonte pas l'instance, elle reste montée et accueille le flux suivant.
        Utiliser `slot.videoId` comme clé annulerait tout le bénéfice.

        Le div englobant reproduit le `wrapper-${videoId}` historique : la directive
        v-resize insère son propre wrapper à l'intérieur, hors du virtual DOM — sans
        ce div, Vue laisserait ce wrapper orphelin dans le DOM au retrait d'un slot.
    -->
    <div
        v-for="slot in slots"
        :key="slot.key"
        v-show="slot.videoId !== null"
        :id="slot.videoId ? `wrapper-${slot.videoId}` : undefined"
    >
        <MediaBroadcastPlayer
            :streamData="slot.streamData"
            :videoId="slot.videoId"
            :nickname="slot.nickname"
            :type="slot.type"
            :peer="slot.peer"
            :roomId="slot.roomId"
            :resizable="true"
            :draggable="true"
        />
    </div>
</template>

<script setup>
import MediaBroadcastPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue'

defineProps({
    // Registre réactif des slots, détenu par usePeerMedia (acquire/release).
    // Un slot libre a `videoId === null`.
    slots: { type: Array, required: true },
})

// `resizable` / `draggable` sont volontairement figés à true, comme dans l'ancien
// createVideoElement : les directives v-resize / v-draggable lisent leurs options
// une seule fois au mounted, elles ne suivraient pas un changement par slot recyclé.
</script>
