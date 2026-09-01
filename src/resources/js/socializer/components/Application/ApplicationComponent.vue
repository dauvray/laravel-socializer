<template>
    <div class="h-100 p-2">
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

        <!--
            En DERNIER dans le wrapper, et pas à la place de l'ancien tag v1 : celui-ci ne
            rendait aucun nœud (`<template></template>`), le provider v2 rend un `<div>`
            qui reçoit en plus les attributs de fallthrough — devant un iframe en
            `height: 100%`, autant le mettre après.

            `:room` TOUJOURS explicite : sans elle la prop retombe sur 'app' et le contextId
            devient `data-app`, celui que System/Notifications.vue occupe en permanence sur
            toute page. Le registre de contextes est en last-write-wins MUET : le dernier
            monté capterait tout le routage entrant et celui-ci resterait vivant et sourd.

            `mode` non écrit ('data' est le défaut) et `options` non passée : un objet
            remplacerait le défaut EN BLOC, faisant disparaître `topology`, qui retomberait
            alors silencieusement sur le mesh dont ce module a besoin.
        -->
        <MediaBroadcastProvider
            ref="dataBroadcast"
            v-if="users && room"
            :users="users"
            :room="room.id"
            :callbacks="dataCallbacks"
        ></MediaBroadcastProvider>
    </div>
</template>
  
<script>

    import { nextTick } from 'vue'
    import { defineAsyncComponent } from 'vue'
    import { mapActions, mapState } from 'pinia'
    import { useApplicationAIStore } from '~socializer/stores/applicationAI.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { dependencies } from './settings.js'
    import MediaBroadcastProvider from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue'
    import { isStringifiedJSon } from '~estarter/services/helpers.js'
    import htmlTemplate from './template.html?raw';
    import Sprinner2 from '~estarter/components/widgets/Spinners/Spinner2.vue'

    export default {
        name: 'ApplicationComponent',
        components: {
            ApplicationModale: defineAsyncComponent(() => import('./widgets/ApplicationModale.vue')),
            MediaBroadcastProvider,
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
            /**
             * Callbacks du canal data, passés au MediaBroadcastProvider.
             *
             * ⚠️ `:callbacks` XOR une initialisation de l'api dans un enfant, jamais les
             * deux : le stockage est write-once par clé et le second jeu serait perdu EN
             * SILENCE. Ici il n'y a pas d'enfant dans le slot, donc c'est bien cette voie.
             *
             * Le provider ne lit cet objet qu'une fois, en onMounted : sa réactivité de
             * computed ne sert à rien. Ce sont les méthodes qu'il pointe qui voient l'état
             * frais, par `this`.
             *
             * @returns {{ onDataReceived: Function, onConnectionOpen: Function, onConnectionClose: Function }}
             */
            dataCallbacks() {
                return {
                    onDataReceived: this.handleDataReceived,
                    onConnectionOpen: this.handleConnectionOpen,
                    onConnectionClose: this.handleConnectionClose,
                }
            },
        },
        methods: {
            ...mapActions(useApplicationAIStore, [
                'databaseAction',
                'loadApplication', 
                'saveApplication'
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
                        this.broadcastToPeers(data)
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
            /**
             * Réception sur le canal data : le message est passé tel quel à l'iframe, qui
             * lit `message.data.event` / `message.data.payload`.
             *
             * ⚠️ Aucun JSON.parse : le sendData de la v2 émet le payload TEL QUEL, là où le
             * store v1 le sérialisait avant d'envoyer. Un JSON.parse laissé en place
             * recevrait un objet et lèverait. Les trois autres JSON.parse de ce fichier
             * (dépendances, message venant de l'iframe, clone avant postMessage) ne sont
             * pas concernés.
             *
             * ⚠️ Et surtout : ne JAMAIS poser de conn.on('data') soi-même. Le transport
             * possède déjà ce listener — un second doublerait chaque réception ET
             * contournerait la garde de taille en entrée comme l'interception des
             * enveloppes d'infra. Le geste est ce callback, pas conn.on('data').
             *
             * @param {{ event: string, payload: * }} data
             * @returns {void}
             */
            handleDataReceived(data) {
                this.sendMessageToIframe(data)
            },
            /**
             * Annonce à l'iframe qu'un pair est joignable.
             *
             * ⚠️ Le garde de sens n'est pas cosmétique ICI PLUS QU'AILLEURS : le
             * `callbackConnection` de la v1 n'était appelé que sur l'entrant, alors
             * qu'`onConnectionOpen` l'est dans les DEUX sens. Sans lui, l'iframe recevrait
             * une annonce de pair portant MON slug — elle se cocherait elle-même comme
             * connectée, sans erreur ni trace.
             *
             * ⚠️ Ce que cette annonce dit, et ce qu'elle NE dit pas : sur une entrante, elle
             * signifie « ce pair m'a joint », **pas** « je peux lui répondre ». `sendData`
             * résout sa connexion par slug dans une map qui ne contient que MES sortantes ;
             * le mapping `slug → peerId` est écrit par ma propre `connectToPeer`, donc sur le
             * chemin présence — où le premier contact est l'entrante de l'autre — ma sortante
             * inverse exige un aller-retour de signalisation complet. L'écart n'est pas une
             * microseconde, il se compte en secondes (mesuré par
             * `scenarios/incomingMappingInvariant.test.js`, dont la table des trois chemins
             * d'admission porte le verdict).
             * Conséquence pour une app d'iframe : ce ✅ est un indicateur d'AFFICHAGE. S'en
             * servir pour décider d'émettre serait un faux vert. Le protocole documenté
             * (`Exemples/WebrtcDataConnection.txt`) ne l'utilise que pour afficher — son
             * ciblage vient des cases cochées, pas d'`enabledConnections`.
             *
             * @param {Object} conn  DataConnection PeerJS
             * @returns {void}
             */
            handleConnectionOpen(conn) {
                if(!this.isIncomingConnection(conn)) {
                    return
                }

                this.sendMessageToIframe({
                    event: 'connectionEnabled',
                    payload: {
                        slug: conn.metadata.from
                    }
                })
            },
            /**
             * Pendant exact de handleConnectionOpen.
             *
             * ⚠️ `onConnectionClose` ne tire qu'UNE fois par connexion (garde
             * `customCloseEmitted`) — mais il tire sur les DEUX connexions de la paire,
             * donc le même garde de sens s'y applique. Sans lui, la fermeture de ma
             * sortante retirerait un pair désigné par mon propre slug.
             *
             * @param {Object} conn  DataConnection PeerJS
             * @returns {void}
             */
            handleConnectionClose(conn) {
                if(!this.isIncomingConnection(conn)) {
                    return
                }

                this.sendMessageToIframe({
                    event: 'connectionDisabled',
                    payload: {
                        slug: conn.metadata.from
                    }
                })
            },
            /**
             * Le sens d'une connexion se lit sur sa metadata, construite par l'émetteur :
             * sur une SORTANTE `from` est mon slug, sur une ENTRANTE c'est celui du pair
             * (épinglé par usePeerOrchestrator.callbacks.test.js). Il n'y a pas de drapeau
             * de sens dans le contrat : c'est au consommateur de poser ce test.
             *
             * Répond `false` faute de slug de part ou d'autre : mieux vaut une annonce
             * manquante qu'une annonce qui me désigne moi.
             *
             * @param {Object} conn  DataConnection PeerJS
             * @returns {boolean}
             */
            isIncomingConnection(conn) {
                const from = conn?.metadata?.from

                if(!from || !this.me?.slug) {
                    return false
                }

                return from !== this.me.slug
            },
            /**
             * Diffuse sur le canal data le message qu'une app d'iframe demande à envoyer.
             *
             * ℹ️ `?.` : le provider est sous v-if alors que le listener `message` est posé
             * inconditionnellement en mounted(). L'ancien sendData était une action de
             * store, donc toujours appelable ; ce ref-ci vaut undefined si le v-if est faux.
             *
             * Pas d'argument de room : elle est figée dans le contexte du provider. Et
             * c'est `message.data` qui part, pas `message` — l'enveloppe `{ action, include,
             * exclude }` est de la mécanique locale, exactement comme le store v1 qui
             * n'émettait que `message.data`.
             *
             * @param {{ action: string, data: *, include?: string[], exclude?: string[] }} message
             * @returns {void}
             */
            broadcastToPeers(message) {
                const payload = this.toTransportable(message.data)

                if(payload === undefined) {
                    return
                }

                this.$refs.dataBroadcast?.api.sendData(payload, this.resolveDestinations(message))
            },
            /**
             * Traduit le ciblage du protocole iframe en `destUserSlugs` de la v2.
             *
             * `include` passe tel quel ; **`exclude` n'a AUCUN équivalent v2** et son
             * complément se calcule ici, depuis `remotePeers`, qui exclut déjà mon slug.
             * Les deux filtres se cumulent, comme le faisait le store v1.
             *
             * ⚠️ Ne PAS se contenter de laisser `include`/`exclude` dans le payload : ils
             * y passeraient comme de simples champs, sans filtrer personne et sans erreur.
             *
             * ⚠️ `null` ⇒ tous les `remotePeers`, mais un tableau VIDE ⇒ personne : côté
             * `sendData`, `destUserSlugs || remotePeers` voit un `[]` comme truthy. C'est
             * ce qui rend « exclure tout le monde » et « n'inclure personne » fidèles à la v1.
             *
             * ℹ️ Écart de périmètre assumé : la v1 partait des connexions OUVERTES, la v2
             * part des membres PRÉSENTS. Un membre sans connexion data produit donc un
             * console.warn par slug au lieu d'être ignoré — la livraison est la même.
             *
             * @param {{ include?: string[], exclude?: string[] }} message
             * @returns {string[]|null}
             */
            resolveDestinations(message) {
                const hasInclude = Array.isArray(message.include)
                const hasExclude = Array.isArray(message.exclude)

                if(!hasInclude && !hasExclude) {
                    return null
                }

                const base = hasInclude
                    ? message.include
                    : (this.$refs.dataBroadcast?.api.remotePeers.value ?? [])

                return hasExclude
                    ? base.filter(slug => !message.exclude.includes(slug))
                    : base
            },
            /**
             * Normalise en données plates le payload d'une app d'iframe, avant émission.
             *
             * ⚠️ Ce n'est PAS un retour à la sérialisation de la v1 : ce qui part sur le fil
             * reste un OBJET, comme le contrat v2 l'exige. Ce que ce passage retire est ce
             * que BinaryPack — la sérialisation par défaut de PeerJS — refuse en LEVANT :
             * Map, Set, instance de classe. Le garde de taille de sendData ne peut pas
             * l'attraper, il mesure via JSON.stringify, qui accepte une Map.
             *
             * Le geste est celui de la v1 (`safeStringify` rendait null et l'envoi était
             * sauté), et il ne retire rien à personne : le récepteur passe ce message à
             * sendMessageToIframe, qui fait DÉJÀ un aller-retour JSON. Rien de non-JSON
             * n'a jamais pu être lu en face.
             *
             * Sans lui, une app d'iframe qui postMessage une Map ferait lever conn.send
             * dans la boucle de diffusion : les pairs suivants ne recevraient rien, et le
             * throw remonterait ici. Le cas est vécu — voir le lot D1 du chantier.
             *
             * @param {*} payload
             * @returns {*|undefined} `undefined` si le payload n'est pas transportable
             */
            toTransportable(payload) {
                try {
                    return JSON.parse(JSON.stringify(payload))
                } catch (e) {
                    console.warn('Payload iframe non transportable, émission abandonnée', e)
                    return undefined
                }
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