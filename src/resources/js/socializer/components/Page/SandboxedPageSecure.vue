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
    import { h, createApp } from 'vue';
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
            const headContent = [
                '<meta charset="UTF-8"/>',
                '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>',
                '<script src="https://unpkg.com/vue@3/dist/vue.global.js"></scr' + 'ipt>',
                '<script src="' + embedScript + '"></scr' + 'ipt>',
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

                        <script>
                            // 
                            // runtime inside the iframe:
                            // - listens to messages from parent
                            // - when receiving { action: 'mount', html, styles, script }, it injects them and mounts components
                            // - expects embed-iframe.js (loaded in head) to fill window.__ESTARTER_COMPONENTS__ = "socializer-comments": (Vue) => ({ /* component definition factory */ })  }
                            // 
                            (function() {
                                // Helper: send data to parent
                                window.sendToParent = (data) => {
                                    try {
                                        parent.postMessage(JSON.stringify(data), "*");
                                    } catch(e) {
                                        // ignore
                                    }
                                };


                                // Utility: mount components found as custom tags
                                function mountCustomTags() {

                                    if (!window.Vue || !window.Vue.createApp) {
                                        console.warn('Vue runtime not available inside iframe');
                                        return;
                                    }

                                    // __ESTARTER_COMPONENTS__ should be registered by embed-iframe.js
                                    const registry = window.__ESTARTER_COMPONENTS__ || {};

                                    // find custom element tags
                                    const tags = Array.from(document.body.querySelectorAll('*')).filter(el => el.tagName.includes('-'));

                                    tags.forEach(el => {
                                        const tag = el.tagName.toLowerCase();
                                        const factoryOrComp = registry[tag];

                                        if (!factoryOrComp) {
                                            // no component provided: leave the DOM as-is (or you can render a placeholder)
                                            console.debug('no registered component for', tag);
                                            return;
                                        }

                                        // build props from attributes
                                        const props = {};
                                        for (const { name, value } of Array.from(el.attributes)) {
                                            props[name.replace(/^:/, '')] = value;
                                        }

                                        // Create mount node and replace
                                        const mountNode = document.createElement('div');
                                        el.replaceWith(mountNode);

                                        // factoryOrComp can be:
                                        //  - a function that receives Vue and returns a component options object
                                        //  - a plain component object

                                        let comp = null;

                                        try {
                                            if (typeof factoryOrComp === 'function') {
                                                comp = factoryOrComp(window.Vue);
                                            } else {
                                                comp = factoryOrComp;
                                            }
                                        } catch (e) {
                                            console.error('Error instantiating component for', tag, e);
                                            return;
                                        }

                                        try {
                                            const app = window.Vue.createApp({
                                                render() { return window.Vue.h(comp, props); }
                                            });

                                            // Provide a minimal eventBus proxy to forward to parent if needed
                                            app.provide('eventBus', {
                                                emit: (name, payload) => window.sendToParent({ action: 'event', name, payload }),
                                                on: () => {} // no-op for now
                                            });

                                            app.config.errorHandler = (err) => {
                                                window.sendToParent({ action: 'error', message: String(err) });
                                            };

                                            app.mount(mountNode);

                                            // keep reference on the mount node for potential unmounts if needed
                                            mountNode.__estarter_app__ = app;
                                            
                                        } catch (err) {
                                            console.error('Failed to mount component', tag, err);
                                        }
                                    });
                                }

                                // Execute inline module script safely: create a <scr type="module"> with the passed content
                                function runModuleScript(code) {
                                    try {
                                        const s = document.createElement('script');
                                        s.type = 'module';
                                        s.textContent = code;
                                        document.body.appendChild(s);
                                    } catch (e) {
                                        console.error('Failed to run module script', e);
                                    }
                                }

                                // Handle mount payload from parent
                                function handleMountPayload(payload) {
                                    // styles
                                    if (payload.styles) {
                                        const style = document.createElement('style');
                                        style.textContent = payload.styles;
                                        document.head.appendChild(style);
                                    }
                                    // html
                                    if (payload.html) {
                                        // append into root container (so we don't stomp runtime)
                                        const container = document.getElementById('__estarter_root__') || document.body;
                                        container.innerHTML = payload.html;
                                    }
                                    // inline script (module)
                                    if (payload.script) {
                                        runModuleScript(payload.script);
                                    }
                                    // allow embed-iframe.js time to register components if it needs async work
                                    // then mount custom tags
                                    setTimeout(() => {
                                        try {
                                            mountCustomTags();
                                        } catch (e) {
                                            console.error(e);
                                        }
                                    }, 50);
                                }

                                // Listen to messages from parent
                                window.addEventListener('message', (ev) => {
                                    let data = ev.data;
                                    try {
                                        data = (typeof data === 'string' && data.startsWith('{')) ? JSON.parse(data) : data;
                                    } catch (e) { /* not json */ }

                                    if (!data || !data.action) return;

                                    if (data.action === 'mount') {
                                        handleMountPayload(data.payload || {});
                                    } else if (data.action === 'eval') {
                                        // debug / run small code (use carefully)
                                        try { eval(data.code); } catch(e) { console.error(e); }
                                    } else if (data.action === 'unmount') {
                                        // unmount all mounted apps
                                        const nodes = Array.from(document.body.querySelectorAll('[__estarter_app__]'));
                                        nodes.forEach(n => {
                                            const app = n.__estarter_app__;
                                            try { app && app.unmount(); } catch(e){}
                                        });
                                        // clear root
                                        const root = document.getElementById('__estarter_root__');
                                        if (root) root.innerHTML = '';
                                    }
                                }, false);

                                // notify parent iframe ready
                                window.sendToParent({ action: 'iframe_ready' });

                            })();
                        </scr` + `ipt>

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
                    script: this.script || ''
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
