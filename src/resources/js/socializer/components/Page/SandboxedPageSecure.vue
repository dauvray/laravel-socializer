<template>
  <div >
    <div class="card-body h-100">
      <iframe
            ref="sandboxFrame"
            style="width: 100%; height: 100%;"
            sandbox="allow-scripts allow-modals allow-forms"
        ></iframe>
        <div v-if="!pageLoaded" class="app-loading">
            <Sprinner2 class="spinner"></Sprinner2>
        </div>
    </div>
  </div>
</template>

<script>
    import { h, createApp,markRaw } from 'vue';
    import { isStringifiedJSon } from '~estarter/services/helpers.js'
    import CommentsWidget from '../Comment/Comments.vue'
    import Picture from '~eblogger/components/widgets/Picture.vue'
    import Sprinner2 from '~estarter/components/widgets/Spinners/Spinner2.vue'

    export default {
        name: 'SandboxedPage',
        inject: ['eventBus'],
        props: {
            html: String,
            styles: String,
            script: String,
        },
        components: {
            Sprinner2,
        },
        data() {
            return {
                pageLoaded: false,
                blobUrl: null,
                // NOTE: cette map n'est plus utilisée pour monter depuis le parent
                // mais la conserve pour référence ou si tu veux l'utiliser côté serveur
                // componentMap: {
                //     'socializer-comments': CommentsWidget,
                //     'eblogger-picture': Picture,
                //     // ajoute ici d’autres SFC si besoin
                // },
                mountedApps: [],
            };
        },
        async mounted() {

            const iframe = this.$refs.sandboxFrame;
            const embedScript = `${import.meta.env.VITE_APP_URL}/vendor/estarter/embed-iframe.js`
            const mountIframeScript = `${import.meta.env.VITE_APP_URL}/vendor/socializer/mountIframeComponents.js`
            const headContent = [
                '<meta charset="UTF-8"/>',
                '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>',
                '<script src="https://unpkg.com/vue@3/dist/vue.global.js"></scr' + 'ipt>',
                '<script src="' + embedScript + '"></scr' + 'ipt>',
                '<script src="' + mountIframeScript + '"></scr' + 'ipt>',
                '<link href="https://cdnjs.cloudflare.com/ajax/libs/line-awesome/1.3.0/line-awesome/css/line-awesome.min.css" rel="stylesheet" />',
            ]

            // Charge le manifest Vite pour récupérer le CSS hashé
            let cssFile = null;
            try {
                const res = await fetch('/build/manifest.json');
                const manifest = await res.json();

                const entryCss = manifest['resources/sass/app.scss'];
                if (entryCss && entryCss.file) {
                    cssFile = `${import.meta.env.VITE_APP_URL}/build/${entryCss.file}`;
                }
                if(cssFile){
                    headContent.push(`<link rel=\"stylesheet\" href=\"${cssFile}\" />`);
                };
            } catch (err) {
                console.warn('Could not load manifest.json', err);
            }

            // -------------------------------------------------------
            // Compose l'HTML complet du document qui tournera dans l'iframe.
            // Ce document contient un "runtime" qui :
            //  - écoute postMessage du parent (action: "mount")
            //  - injecte html/styles/script
            //  - cherche les tags custom et tente de monter des composants
            //    à partir de window.__ESTARTER_COMPONENTS__ (défini par embed-iframe.js)
            //  - expose sendToParent pour envoyer des events
            // -------------------------------------------------------

            const iframeHtml = `
                <!doctype html>
                <html lang="en">
                    <head>
                        ${headContent.join('')}
                        <style>html,body{height:100%;margin:0;padding:0}</style>
                    </head>
                    <body style="overflow:auto;">
                        <div id="__estarter_root__"></div>
                    </body>
                </html>
            `;

            // create blob + objectURL
            const blob = new Blob([iframeHtml], { type: 'text/html' });
            this.blobUrl = URL.createObjectURL(blob);

            // load the sandboxed iframe
            iframe.src = this.blobUrl;

            window.addEventListener('message', this.handleMessageFromIframe);

            // marque la page loaded dès que l'iframe navigue (visually)
            iframe.addEventListener('load', () => {
                // la logique réelle de montage se fera après réception de 'iframe_ready'
                this.pageLoaded = true;
            });
        },
        beforeUnmount() {
            // Unmount all child Vue apps
            this.mountedApps.forEach(app => app.unmount());
            this.mountedApps = [];
            // cleanup
            if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
            window.removeEventListener('message', this.handleMessageFromIframe)
        },
        methods: {
            handleMessageFromIframe(event) {
                let data = event.data;

                if (isStringifiedJSon(data)) {
                    data = JSON.parse(data);
                }
               
                if (data.action === 'resize_iframe') {
                    this.$refs.sandboxFrame.style.height = `${data.height}px`;
                }
                if(data.action === 'iframe_ready') {
                    this.sendMountPayload();
                }
            },
            sendMountPayload() {
                const iframe = this.$refs.sandboxFrame;
                const payload = {
                    html: this.html || '',
                    styles: this.styles || '',
                    script: this.script || '',
                };

                try {
                    iframe.contentWindow.postMessage(JSON.stringify({ action: 'mount', payload }), '*');
                } catch (err) {
                    console.error('postMessage to iframe failed', err);
                }
            }
        },
    };
</script>
