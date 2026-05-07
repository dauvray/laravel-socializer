<template>
    <ul>
        <li>
            Room : {{ api.onAirRoom }}
        </li>
        <li>
            Type : {{ api.currentType }}
        </li>
        <li>
            Users : {{ api.usersInRoom }}
        </li>
    </ul>
</template>

<script setup>
    const props = defineProps({
        api: Object,
    })
</script>