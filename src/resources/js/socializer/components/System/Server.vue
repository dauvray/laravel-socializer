<template>
    <div id="system-socializer">
        <div id="system-socializer-tools">
            <NavWidget menuId="main-socializer-navbar" :menu="menu"/>
        </div>
        <NotificationsSocializer></NotificationsSocializer>
    </div>
    <ServerEstarter
        :themeactivated="themeactivated"
        :theme="theme"
        :notificationactived="notificationactived"
        :a11yactivated="a11yactivated"
        :navigationA11y="navigationA11y"
        :logged="logged">
            <slot></slot>
    </ServerEstarter>
    
</template>

<script>
    import ServerEstarter from '~estarter/components/widgets/System/Server.vue'
    import NotificationsSocializer from './Notifications.vue'
    import { useStatusUsersObserver } from '~socializer/components/System/composables/useStatusUsersObserver.js'
    import NavWidget from '~estarter/components/widgets/Nav.vue'
    import { mapActions } from 'pinia'
    import { useApplicationStore } from '~estarter/stores/application.js'
    import { useAjaxService } from '~estarter/services/AjaxService.js'
    const AjaxService = useAjaxService()

    export default {
        name: "Server",
        components: {
            ServerEstarter,
            NotificationsSocializer,
            NavWidget,
        },
        props: {
            notificationactived: {
                type: Boolean,
                required: false,
                default: true
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
        data() {
            return {
                menu: [],
            }
        },
        async created() {
            const result = await AjaxService.load('/menu-spa/Menu Socializer')
            this.menu = result.data
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