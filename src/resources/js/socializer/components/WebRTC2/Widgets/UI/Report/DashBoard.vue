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
                <li>
                    Topology : {{ api.topology }}
                    <template v-if="api.topology.value === 'star'">
                        <ul>
                            <li>
                                Hub Slug : {{ api.hubSlug }}
                            </li>
                            <li>{{ typeof api.isHub }}
                                Am i Hub : <span :class="{'text-success': api.isHub.value, 'text-danger': !api.isHub.value}">{{ api.isHub }}</span>
                            </li>
                            <li>
                                Hub Connected : <span :class="{'text-success': api.isHubConnected.value, 'text-danger': !api.isHubConnected.value}">{{ api.isHubConnected }}</span>
                            </li>
                        </ul>
                    </template>
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