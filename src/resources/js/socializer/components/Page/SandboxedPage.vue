<template>
  <div >
    <div class="card-body h-100">
      <iframe
            ref="sandboxFrame"
            style="width: 100%; height: 100%;"
            sandbox="allow-scripts allow-same-origin allow-modals allow-forms"
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
                componentMap: {
                    'socializer-comments': CommentsWidget,
                    'eblogger-picture': Picture,
                    // ajoute ici d’autres SFC si besoin
                },
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
            const res = await fetch('/build/manifest.json');
            const manifest = await res.json();

            const entryCss = manifest['resources/sass/app.scss'];
            if (entryCss && entryCss.file) {
                cssFile = `${import.meta.env.VITE_APP_URL}/build/${entryCss.file}`;
            }
            if(cssFile){
                headContent.push(`<link rel=\"stylesheet\" href=\"${cssFile}\" />`);
            };


            // Prépare le contenu iframe
            const srcdoc = `<!DOCTYPE html><html lang="en"><head>${headContent.join('')}</head><body style="overflow:hidden;"></body></html>`;
            iframe.srcdoc = srcdoc;


            // Quand l'iframe est prête, injecte et monte
            iframe.addEventListener('load', () => {
                const doc = iframe.contentDocument || iframe.contentWindow.document;

                // Styles inline
                if (this.styles) {
                    const styleTag = doc.createElement('style');
                    styleTag.textContent = this.styles;
                    doc.head.appendChild(styleTag);
                }

                // HTML brut
                if (this.html) {
                    const raw = doc.createElement('div');
                    raw.innerHTML = this.html;
                    doc.body.appendChild(raw);
                }

                // Montage des composants
                this.parseAndMountComponentsInIframe(doc);

                // Script inline
                if (this.script) {
                    const scriptTag = doc.createElement('script');
                    scriptTag.type = 'module';
                    scriptTag.textContent = this.script;
                    doc.body.appendChild(scriptTag);
                }
                this.pageLoaded = true

                // Intercepter les clics sur les ancres
                doc.querySelectorAll('a[href^="#"]').forEach(a => {
                    a.addEventListener('click', e => {
                        e.preventDefault();
                        const id = a.getAttribute('href').substring(1);
                        const target = doc.getElementById(id);
                        if (target) {
                        target.scrollIntoView({ behavior: 'smooth' });
                        }
                    });
                });
            });

            window.addEventListener('message', this.handleMessageFromIframe);
        },
        beforeUnmount() {
            // Unmount all child Vue apps
            this.mountedApps.forEach(app => app.unmount());
            this.mountedApps = [];
            window.removeEventListener('message', this.handleMessageFromIframe)
        },
        methods: {
            parseAndMountComponentsInIframe(doc) {
                const tags = Array.from(doc.body.querySelectorAll('*')).filter(el => el.tagName.includes('-'));
                for (const el of tags) {
                    const tag = el.tagName.toLowerCase();
                    const Comp = this.componentMap[tag];
                    if (!Comp) continue;

                    const props = {};
                    for (const { name, value } of el.attributes) {
                        props[name.replace(/^:/, '')] = value;
                    }

                    const mountNode = doc.createElement('div');
                    el.replaceWith(mountNode);

                    const app = createApp({ render: () => h(Comp, props) });
                    app.provide('eventBus', this.eventBus);
                    app.config.errorHandler = err => console.error('Vue error in iframe:', err);
                    app.mount(mountNode);
                    this.mountedApps.push(app);
                }
            },
            handleMessageFromIframe(event) {
                let data = event.data;
                if (isStringifiedJSon(data)) {
                    data = JSON.parse(data);
                }
                if (data.action === 'resize_iframe') {
                    this.$refs.sandboxFrame.style.height = `${data.height}px`;
                }
            }
        },
    };
</script>
