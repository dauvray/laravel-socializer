<template>
    <div id="system-socializer">
        <div id="system-socializer-tools">
            <NavBarWidget id="main-socializer-navbar" menuName="Menu Socializer"/>
        </div>
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
    import NavBarWidget from '~estarter/components/widgets/NavBar.vue'
     import { mapActions } from 'pinia'
    import { useApplicationStore } from '~estarter/stores/application.js'

    export default {
        name: "Server",
        components: {
            ServerEstarter,
            NotificationsSocializer,
            NavBarWidget,
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
        mounted() {
            const baseUrl = `${import.meta.env.VITE_APP_URL}/${import.meta.env.VITE_VUE_APP_URL}`;
            const currentUrl = window.location.href;
            // force reload if not in SPA mode
            if (!currentUrl.startsWith(baseUrl)) {
                this.setIsSPa(false)
            }
        },
        methods: {
            ...mapActions(useApplicationStore, [
                'setIsSPa',
            ]),
        },
    }
</script>