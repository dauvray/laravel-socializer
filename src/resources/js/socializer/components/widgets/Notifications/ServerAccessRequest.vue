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
                    <p class="card-text">Souhaite un accès au serveur privé.</p>
                    <p class="fs-4">{{ notification.data.server.name }}</p>
                </div>

            </div>
            <div class="btn-group btn-group-sm d-flex" role="group">
                <button type="button" class="btn btn-success" @click="onAccept">Accepter</button>
                <button type="button" class="btn btn-danger" @click="onRefuse">Refuser</button>
            </div>

        </div>
    </div>
</template>

<script>
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'
    import { mapActions } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'

    export default {
        name: "ServerAccessRequest",
        props: {
            notification: {
                type: Object,
                required: true
            }
        },
        components: {
            Gravatar,
            UserWallLink,
        },
        methods: {
            ...mapActions(useServerStore, [
                'responseServerAccess',
            ]),
            onAccept() {
                this.sendResponse(true)
            },
            onRefuse() {
                this.sendResponse()
            },
            sendResponse(response = false) {
                this.responseServerAccess({
                    notification_id: this.notification.data.notification_id,
                    server_vid: this.notification.data.server.id,
                    user_id: this.notification.data.from.id,
                    response: response
                })
            }
        }
    }
</script>