<template>
    <ServerParamsButton
        id="room-params"
        :server="currentServer"
        :serverUsers="serverUsers"
        @create-room="onCreateRoom"
        @delete-server="onDeleteServer"
        @edit-server="onEditServer"
        @add-module="onAddModule"
    ></ServerParamsButton>

    <RoomParamsWrapper
        id="room-list"
        :currentServer="currentServer"
        :rooms="rooms"
        @delete-room="onDeleteRoom"
        @edit-room="onEditRoom"
        @sort-up-room="onSortUpRoom"
        @sort-down-room="onSortDownRoom"
    ></RoomParamsWrapper>
</template>

<script>
    import ServerParamsButton from './ServerParamsButton.vue'
    import RoomParamsWrapper from './RoomParamsWrapper.vue'

    export default {
        name: 'RoomSidebar',
        components: {
            ServerParamsButton,
            RoomParamsWrapper
        },
        emits: [
            'create-room',
            'delete-server',
            'edit-server',
            'add-module',
            'delete-room',
            'edit-room',
            'sort-up-room',
            'sort-down-room',
        ],
        props: {
            currentServer: {
                type: Object,
                required: true
            },
            serverUsers: {
                type: Array,
                required: true
            },
            rooms: {
                type: Array,
                required: true
            }    
        },
        methods: {
            onCreateRoom(event) {
                this.$emit('create-room', event)
            },
            onEditServer(server) {
                this.$emit('edit-server', server)
            },
            onDeleteServer(serverId) {
                this.$emit('delete-server', serverId)
            },
            onAddModule() {
                this.$emit('add-module')
            },
            onDeleteRoom(payload) {
                this.$emit('delete-room', payload)
            },
            onEditRoom(payload) {
                this.$emit('edit-room', payload)
            },
            onSortUpRoom(index) {
                this.$emit('sort-up-room', index)
            },
            onSortDownRoom(index) {
                this.$emit('sort-down-room', index)
            },
        },
    }
</script>