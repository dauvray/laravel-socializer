<template>

    <div v-if="currentRoom"
        class="room-wrapper">
        <div id="room-navigation"></div>
        <Teleport :to="`#collapser-${currentRoom.id}`" >
            <div class="list-group list-group-flush">
                <router-link 
                    v-for="(content, index) in roomContent"  
                    :to="{ name: content.content_type, params: { vertexId: content.id }}" 
                    class="room-name">
                    {{ content.name }}
                </router-link>
            </div>
        </Teleport>

        <router-view
            v-if="!roomLocked"
            :editable="isOwner"
            :users="users"
            :room="currentRoom"
        ></router-view>
        <LockedRoom v-else></LockedRoom>

    </div>
</template>

<script>
    import { mapActions, mapState } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'
    import { defineAsyncComponent } from '@vue/runtime-core'

    export default {
        name: 'Room',
        emits: [
            'update-users-room',
            'joining-user-room',
            'leaving-user-room',
        ],
        components: {
            IconWidget: defineAsyncComponent(() => import('~estarter/components/widgets/IconWidget.vue')),
            LockedRoom: defineAsyncComponent(() => import('./widgets/LockedRoom.vue')),
        },
        data() {
            return {
                users: [],
                roomLocked: false,
            }
        },
        async created() {
            await this.loadRoom(this.$route.params.roomId)
            this.loadDefaultContent()
        },
        unmounted() {
            this.resetCurrentRoom()
            Echo.leave(this.channel)
        },
        computed: {
            ...mapState(useServerStore, {
                currentRoom: 'getCurrentRoom',
                isOwner: 'isOwner',
                roomContent: 'getCurrentRoomContent',
            }),
            channel: function() {
                if(this.currentRoom) {
                    return `room.${this.currentRoom.id}`
                }
               // return null
            },
        },
        watch: {
            '$route' (to, from ) {
                // is stay on same server
                if(to.params.hasOwnProperty('serverId') && to.params.serverId === from.params.serverId 
                        && !to.params.hasOwnProperty('vertexId')){
                  this.loadDefaultContent()
                }
            },
            channel(newVal, oldVal) {
                if(oldVal) {
                    Echo.leave(oldVal)
                }
                if(newVal) {
                    this.initRoomEvents()
                }
            },
            currentRoom(newRoom) {
                if(newRoom && newRoom.hasOwnProperty('content_type') && newRoom.content_type === "locked") {
                    this.roomLocked = true
                }
            }
        },
        methods: {
            ...mapActions(useServerStore, [
                'loadRoom',
                'resetCurrentRoom',
            ]),
            initRoomEvents() {
                if(this.channel) {
                    Echo.leave(this.channel)
                    Echo.join(this.channel)
                        .here((users) => {
                            this.users = users
                            this.$emit('update-users-room', this.users)
                        })
                        .joining((user) => {
                            this.users.push(user)
                            this.$emit('joining-user-room', user)
                            this.$emit('update-users-room', this.users)
                        })
                        .leaving((user) => {
                            this.users = this.users.filter( item => {
                                return user.id != item.id
                            })
                            this.$emit('leaving-user-room', user)
                            this.$emit('update-users-room', this.users)
                        })
                        .error((error) => {
                            console.error(error);
                        })
                }
            },
            loadDefaultContent() {
                if(this.currentRoom.hasOwnProperty('content')) {
                    const defaultContent = this.currentRoom.content[0]
                    this.$router.push({ name: defaultContent.content_type, params: { vertexId: defaultContent.id } })
                }
            },
        },
    }
</script>