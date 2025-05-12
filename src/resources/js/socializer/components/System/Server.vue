<template>
    <div id="system-socializer">
        <NotificationsSocializer></NotificationsSocializer>
        <ServerEstarter
            :themeactivated="themeactivated"
            :theme="theme"
            :notificationactived="notificationactived"
            :a11yactivated="a11yactivated"
            :navigationA11y="navigationA11y"
            :logged="logged"
        ></ServerEstarter>
    </div>
</template>

<script>
    import ServerEstarter from '~estarter/components/widgets/System/Server.vue'
    import NotificationsSocializer from './Notifications.vue'
    import { useStatusUsersObserver } from '~socializer/components/System/composables/useStatusUsersObserver.js'

    export default {
        name: "Server",
        components: {
            ServerEstarter,
            NotificationsSocializer,
        },
        props: {
            notificationactived: {
                type: Boolean,
                required: false,
            },
            a11yactivated: {
                type: Boolean,
                required: false,
                default: false
            },
            theme: {
                type: String,
                required: false,
                default: 'light'
            },
            themeactivated: {
                type: Boolean,
                required: false,
                default: false
            },
            navigationA11y: {
                type: Array,
                required: false,
                defaut: []
            },
            logged: {
                type: Boolean,
                required: false,
                default: false
            },
        },
        setup() {
            useStatusUsersObserver('#main-content')
        },
    }
</script>