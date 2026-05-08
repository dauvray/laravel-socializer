<template>
    <div class="card mb-3">
        <div class="card-body">
        <ul>
            <li>
                Room : {{ api.onAirRoom }}
            </li>
            <li>
                Type : {{ api.currentType }}
            </li>
            <li>
                Remote users : {{ api.usersInRoom }}
            </li>
        </ul>
        </div>
    </div>
</template>

<script setup>
    const props = defineProps({
        api: Object,
    })
</script>