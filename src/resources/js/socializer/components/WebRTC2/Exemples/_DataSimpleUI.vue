<template>
    <ul>
        <li>
            Name : {{ api.myName }}
        </li>

        <li>
            Room : {{ api.onAirRoom }}
        </li>
        <li>
            Type : {{ api.currentType }}
        </li>
        <li>
            Users : {{ api.remotePeers }}
        </li>
    </ul>
</template>

<script setup>

// composant de base pour les interactions de données simples (chat, commandes, etc.)
// à adapter selon les besoins spécifiques de l’application
// ce composant est conçu pour être utilisé avec le composable useMediaBroadcast 
// en mode 'data'
// il expose une interface très simple pour envoyer des données à tous les utilisateurs de la room
// et affiche quelques informations de base sur la connexion et les utilisateurs présents.
// il peut être utilisé comme point de départ pour créer des interfaces plus complexes selon les besoins de l’application

    const props = defineProps({
        api: Object,
    })
</script>
