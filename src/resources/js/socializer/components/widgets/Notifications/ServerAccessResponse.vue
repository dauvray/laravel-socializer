<template>
    <div class="card">
        <div class="card-body">
            <div class="d-flex">
                <Gravatar
                    :user="{
                        name: notification.data.from.name,
                        image: notification.data.from.image,
                    }"
                    size="small"
                    :showStatus="false"
                ></Gravatar>
                <div class="ms-2 mb-2">
                    <div class="d-flex flex-column mb-2">
                        <UserWallLink 
                            :dropdown="false"
                            :user="{
                                name: notification.data.from.name,
                                slug: notification.data.from.slug,
                                function: notification.data.from.function,
                            }">
                        </UserWallLink>
                        <small>{{ notification.data.from.function }}</small>
                    </div>
                    <p v-if="notification.data.server.has_access" class="card-text">Vous autorise à accéder au serveur:</p>
                    <p v-else class="card-text">Ne vous autorise pas à accéder au serveur:</p>
                    <p class="fs-4">{{ notification.data.server.name }}</p>
                </div>

            </div>
            <div class="btn-group btn-group-sm d-flex" role="group">
                <button v-if="notification.data.server.has_access" type="button" class="btn btn-success" @click="onVisit">Visiter</button>
                <button type="button" class="btn btn-danger" @click="onDelete">Supprimer</button>
            </div>

        </div>
    </div>
</template>

<script>
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'

    export default {
        name: "ServerAccessResponse",
        props: {
            notification: {
                type: Object,
                required: true
            }
        },
        emits: [
            'remove-unread-notification',
        ],
        components: {
            Gravatar,
            UserWallLink,
        },
        methods: {
            onVisit() {
                this.$router.push({ name: 'server', params: { serverId: this.notification.data.server.id } })
                this.onDelete()
            },
            onDelete() {
                this.$emit('remove-unread-notification', this.notification.data.notification_id, true)
            }
        }
    }
</script>