<template>
    <div class="h-100 p-2">
        <DataUserPeerConnection 
            v-if="users && room"
            :users="users"
            :roomId="room.id"
            :callback-connection="connectionDataCallback"
        ></DataUserPeerConnection>

        <ApplicationModale
            v-if="componentLoaded && editable"
            :componentData="componentData"
            :componentInfos="componentInfos"
            :modelPlaceholder="componentInfos"
            @save-changes="onSaveUpdatedModal"
        ></ApplicationModale>

        <div v-if="!componentLoaded" class="app-loading">
            <Sprinner2 class="spinner"></Sprinner2>
        </div>

        <iframe
            :class="{'opacity-0': !componentLoaded}"
            ref="sandboxFrame"
            style="width: 100%; height: 100%;"
            sandbox="allow-scripts allow-same-origin allow-modals allow-forms"
        ></iframe>
    
        <div v-if="error" class="error">
            {{ error }}
        </div>
    </div>
</template>
  
<script>

    import { nextTick } from 'vue'
    import { defineAsyncComponent } from 'vue'
    import { mapActions, mapState } from 'pinia'
    import { usePeerStore } from '~socializer/stores/peers.js'
    import { useApplicationAIStore } from '~socializer/stores/applicationAI.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { dependencies } from './settings.js'
    import DataUserPeerConnection from '~socializer/components/WebRTC/widgets/DataUserPeerConnection.vue'
    import { isStringifiedJSon } from '~estarter/services/helpers.js'
    import htmlTemplate from './template.html?raw';
    import Sprinner2 from '~estarter/components/widgets/Spinners/Spinner2.vue'

    export default {
        name: 'ApplicationComponent',
        components: {
            ApplicationModale: defineAsyncComponent(() => import('./widgets/ApplicationModale.vue')),
            DataUserPeerConnection,
            Sprinner2,
        },
        props: {
            users: {
                type: Array,
                default: () => []
            },
            room: {
                type: Object,
                default: () => {}
            },
            editable: {
                type: Boolean,
                required: true,
            },
        },
        data() {
            return {
                database: null,
                componentLoaded: false,
                componentData: '',
                componentInfos: null,
                error: null,
            }
        },
        async mounted() {
            await nextTick()
            window.addEventListener('message', this.handleMessageFromIframe)
            this.$refs.sandboxFrame.onload = () => {}
        },
        beforeUnmount() {
            window.removeEventListener('message', this.handleMessageFromIframe)
        },
        watch: {
            users: {
                async  handler(newUsers) {
                    if(!this.componentLoaded) {
                        await this.loadComponent()
                    }
                    this.sendMessageToIframe({ 
                        event:'users', 
                        payload: this.filterdUsers
                    })
                },
                deep: true
            }
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            filterdUsers() {
                return this.users.map(user => {
                    return {
                        slug: user.slug,
                        function: user.function,
                        name: user.name,
                        image: user.image,
                        is_me: user.slug === this.me.slug,
                    }
                })
            },
        },
        methods: {
            ...mapActions(useApplicationAIStore, [
                'databaseAction',
                'loadApplication', 
                'saveApplication'
            ]),
            ...mapActions(usePeerStore, [
                'sendData',
            ]),
            async loadComponent() {
                try {
                    let result = await this.loadApplication({
                        room_id: this.room.id,
                    })

                    this.database = result.data
                    this.componentData = result.code
                    this.componentInfos = result.infos

                    if(this.componentData) {

                        /**
                         * Construit et injecte le contenu complet dans l'iframe.
                         * Ce contenu charge Vue depuis un CDN, injecte le style et crée
                         * une application Vue qui utilise le composant dynamique.
                         */

                        if (!this.$refs.sandboxFrame || !this.componentData) return

                        const iframe = this.$refs.sandboxFrame
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document

                        let dependenciesURL = ''
                        if(this.componentData.hasOwnProperty('dependencies')) {

                            if(isStringifiedJSon(this.componentData.dependencies)) {
                                this.componentData.dependencies = JSON.parse(this.componentData.dependencies)
                            }

                            dependenciesURL = this.componentData.dependencies.map(dep => {
                                dep = dep.toLowerCase().replace(" ", ".")
                                let url = dependencies[dep]
                               
                               if(Array.isArray(url)) {
                                    url.forEach((u) => {
                                        return this.getDependencyLink(u)
                                    })
                               } else {
                                    return this.getDependencyLink(url)
                               }
                            }).join('')
                        }

                        // Remplacement des placeholders dans le template HTML importé
                        const processedHtml = htmlTemplate
                        .replace('<!-- DEPENDENCIES_PLACEHOLDER -->', dependenciesURL )
                        .replace('<!-- STYLE_PLACEHOLDER -->', this.componentData.style || '')
                        .replace('<!-- SCRIPT_PLACEHOLDER -->', this.componentData.script || '')
                        .replace('<!-- TEMPLATE_PLACEHOLDER -->', JSON.stringify(this.componentData.template))
                        .replace('<!-- TRANSLATION_PLACEHOLDER -->',  JSON.stringify(this.componentData.translations))
                        .replace('<!-- USERS_PLACEHOLDER -->', JSON.stringify(this.filterdUsers))
                        .replace('<!-- ROOM_PLACEHOLDER -->', JSON.stringify(this.room))
                        .replace('<!-- DATABASE_PLACEHOLDER -->', JSON.stringify(this.database));

                        iframeDoc.open()
                        iframeDoc.write(processedHtml)
                        iframeDoc.close()
                    } 

                } catch (err) {
                    this.error = `Erreur : ${err.message}`
                    console.error(err)
                }
            },
            getDependencyLink(url) {
                 const regex = /min.css/g
                if (url.search(regex) != -1) {
                    return '<link rel="stylesheet" href="'+url+'">'
                } else {
                    return '<scr'+'ipt src="'+url+'"></scr'+'ipt>'
                }
            },
            async onSaveUpdatedModal(payload) {

                this.componentData = payload.code
                this.componentInfos = payload.infos

                await this.saveApplication({
                    room_id: this.room.id,
                    vertexid: this.room.content[0].id,
                    data: payload
                })
                 await this.loadComponent()
            },
            async handleMessageFromIframe(event) {
                if(event.origin !== import.meta.env.VITE_APP_URL) {
                    console.log('Message non autorisé')
                    return
                }

                const data = isStringifiedJSon(event.data) ? JSON.parse(event.data) : event.data
                const action = data.action
                const payload = data.data

                switch(action) {
                    case'database':
                        const response = await this.databaseAction({...payload, vertexid: this.room.content[0].id})
                        this.sendMessageToIframe(response)
                        break
                    case'broadcast':
                        this.sendData({
                            ...data,
                        }, this.room.id)
                        break
                    case'resize_iframe':
                        this.$refs.sandboxFrame.style.height = Number( data.height )
                        this.componentLoaded = true
                        break
                    default:
                        console.log('Action non reconnue')
                }
            },
            sendMessageToIframe(message){
                if (this.$refs.sandboxFrame && this.$refs.sandboxFrame.contentWindow) {
                    this.$refs.sandboxFrame.contentWindow.postMessage(JSON.parse(JSON.stringify(message, window.location.origin)))
                }
            },
            /*------  DATA CONNECTION ----------*/
            connectionDataCallback(conn) {
                console.log('nouvelle connexion data chat')
                conn.on("data", (data) => {
                    data = JSON.parse(data)
                    console.log('data reçue' , data)
                    this.sendMessageToIframe(data)
                });

                conn.on("open", () => {
                    console.log('connection data chat ouverte', conn)
                    this.sendMessageToIframe({
                        event: 'connectionEnabled',
                        payload: { 
                             slug: conn.metadata.from
                        }
                    })
                });

                conn.on("close", () => {
                    console.log('connection data chat fermée')
                    this.sendMessageToIframe({
                        event: 'connectionDisabled',
                        payload: { 
                             slug: conn.metadata.from
                        }
                    })
                });
            },
        }
    }
</script>
  
<style lang="scss" scoped>
    .app-loading {
        display: flex;
        width: 100%;
        height: 100%;
        position: absolute;
        text-align: center;
        font-size: 1.2em;

        .spinner {
            align-items: center;
        }
    }
    
    .error {
        padding: 20px;
        text-align: center;
        color: #ff4444;
        font-weight: bold;
    }
</style>