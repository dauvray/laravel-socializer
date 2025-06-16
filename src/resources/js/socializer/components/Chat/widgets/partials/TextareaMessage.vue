<template>
    <div class="message-input-container">
        <Wysiwyg v-if="wysiwyg"
            class="message-input"
            v-model:content="message"
        ></Wysiwyg>
        <div v-else
            class="message-input"
            id="auto-growing-textarea" 
            ref="messengerInput"
            contenteditable="true" 
            @keydown="onKeyDown"
            @focus="onStartWritting"
            @blur="onStopWritting"
            @paste="onPaste"
            @input="onInput"
        ></div>
        
        <div class="message-input-tools">
            <button v-if="isDirty" type="button" 
                class="btn btn-link text-light" 
                title="Effacer" 
                @click="onDeleteTextearea">
                <IconWidget icon="times"></IconWidget>
            </button>
            <div class="vr"></div>

            <!-- Affichage normal des boutons sur lg+ -->
            <TextareaToolsButtons
                v-if="isLgUp"
                icon-color="text-light"
                @selected-emoji="onSelectedEmoji"
                @selected-file="onSelectedFile"
                @open-wysiwyg="onWysiwyg"
                @record-result="onRecorded"
                @text-voiced="onTextVoiced"
            ></TextareaToolsButtons>
           
            <!-- Dropdown sur sm/md -->
            <div v-else class="dropdown">
                <button class="btn btn-link dropdown-toggle" 
                    type="button" 
                    data-bs-toggle="dropdown" 
                    aria-expanded="false">
                    <IconWidget icon="tools"></IconWidget>
                </button>
                <ul class="dropdown-menu">
                    <li>
                        <a class="dropdown-item" href="#">
                            <TextareaToolsButtons
                                icon-color="text-light"
                                @selected-emoji="onSelectedEmoji"
                                @selected-file="onSelectedFile"
                                @open-wysiwyg="onWysiwyg"
                                @record-result="onRecorded"
                                @text-voiced="onTextVoiced"
                            ></TextareaToolsButtons>
                        </a>
                    </li>
                </ul>
            </div>

            <div class="vr"></div>
            <button type="button" 
                class="btn btn-link text-light" 
                title="Envoyer" 
                id="sendButton"
                :disabled="!isDirty" 
                @click="onSendMessage">
                <IconWidget icon="paper-plane"></IconWidget>
            </button>
        </div>
    </div>
</template>

<script>

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import TextareaToolsButtons from '~socializer/components/Chat/widgets/partials/TextareaToolsButtons.vue'
    import { defineAsyncComponent } from '@vue/runtime-core'
    import { debounce } from '~estarter/services/helpers.js'
    import Uppy from '@uppy/core'
    import Compressor from '@uppy/compressor';
    import { uniqueId } from '~estarter/services/helpers.js'
    import { useBreakpoints } from '~socializer/composables/useBreakpoints'
    import { computed } from 'vue'

    export default {
        name: 'TextareaMessage',
        inject: ["eventBus"],
        components: {
            IconWidget,
            TextareaToolsButtons,
            Wysiwyg:  defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/atoms/Wysiwyg.vue')),
        },
        emits: [
            'start-writting',
            'stop-writting',
            'send-message',
            'open-wysiwyg',
            'update-height',
            'record-result',
            'file-added',
            'file-removed',
        ],
          setup() {
            const { up } = useBreakpoints()
            const isLgUp = computed(() => up.lg.value)
            return {
                isLgUp
            }
        },
        data() {
            return {
                message: '',
                wysiwyg: false,
                nb_attachedFiles: 0,
                uppy: null,
                uid: uniqueId(),
                pastedImage: null,
                pastedImageUrl: null,
                breakPoints: null, // Bootstrap lg breakpoint
            };
        },
        created() {
            // Initialiser la fonction debounced
            this.debouncedAction = debounce(this.formatContent, 500);
        },
        mounted() {
            this.uppy = new Uppy({ 
                id: `${this.uid}-Uppy`,
                autoProceed: false 
            })
            .use(Compressor, {
                id: `${this.uid}-Compressor`,
            })

            const inputEl = this.$refs.messengerInput

            inputEl.addEventListener('dragover', (e) => {
                e.preventDefault()
                inputEl.classList.add('drag-over')
            })

            inputEl.addEventListener('dragleave', () => {
                inputEl.classList.remove('drag-over')
            })

            inputEl.addEventListener('drop', (e) => {
                e.preventDefault()
                inputEl.classList.remove('drag-over')

                const files = Array.from(e.dataTransfer.files)
                files.forEach(file => {
                    this.uppy.addFile({
                        name: file.name,
                        type: file.type,
                        data: file,
                        source: 'DOM Drop',
                    })
                })
            })

            this.uppy.on('file-added', (file) => {
                this.$emit('file-added', file)
                this.nb_attachedFiles += 1
            })

            this.uppy.on('file-removed', (file) => {
                this.$emit('file-removed', file)
                this.nb_attachedFiles -= 1
            })

            window.addEventListener('resize', this.updateBreakpoint)
            this.updateBreakpoint()
        },
        beforeUnmount() {
            if (this.uppy) {
                this.uppy.destroy()
                this.uppy = null
            }

             window.removeEventListener('resize', this.updateBreakpoint)
        },
        watch: {
            message: function() {
               this.onInput();
            },
        },
        computed: {
            isDirty: function() {
                return this.message.trim() !== '' || this.nb_attachedFiles > 0;
            },
        },
        methods: {
            onStartWritting() {
                this.$emit('start-writting')
            },
            onStopWritting() {
                this.$emit('stop-writting')
            },
            onSendMessage() {
                if (!this.wysiwyg) {
                    this.$emit('send-message', this.$refs.messengerInput.innerHTML) 
                    this.$refs.messengerInput.innerHTML = ''
                    this.message = ''
                } else {
                    this.$emit('send-message', this.message)
                    this.message = ''
                    this.wysiwyg = false
                }
                this.uppy.clear() 
            },
            onSelectedEmoji(emoji) {
                if (!this.wysiwyg) {
                    // Insérer l'emoji à la position du curseur
                    const selection = window.getSelection();
                    if (selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        const textNode = document.createTextNode(emoji);
                        range.insertNode(textNode);
                        
                        // Positionner le curseur après l'emoji
                        range.setStartAfter(textNode);
                        range.setEndAfter(textNode);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    } else {
                        this.$refs.messengerInput.appendChild(document.createTextNode(emoji));
                    }
                    
                    // Déclencher l'événement input pour mettre à jour
                    this.onInput({ target: this.$refs.messengerInput });
                } else {
                    this.message = this.message + emoji
                }
            },
            onSelectedFile(file) {
                this.uppy.addFile({
                    name: file.name,
                    type: file.type,
                    data: file,
                })
            },
            onWysiwyg() {
                if (!this.wysiwyg) {
                   this.message = this.$refs.messengerInput.innerHTML
                   this.eventBus.$emit("disable-pointer-event", 'messenger-wysiwyg')
                   this.wysiwyg = true
                } else {
                    this.wysiwyg = false
                    setTimeout(() => {
                         this.$refs.messengerInput.innerHTML = this.message
                    }, 100)
                    this.eventBus.$emit("enable-pointer-event")
                }
                 this.$emit('open-wysiwyg', this.wysiwyg)
            },
            onInput(event) {
               
                let html

                html =  event ? event.target.innerHTML.trim() : this.message.trim();

                // Filtrer les faux contenus vides
                if (html === '<br>' || html === '&nbsp;' || html === '') {
                    this.message = '';
                } else {
                    this.message = html;
                }

                if(this.$refs.messengerInput) {
                    this.$emit('update-height', this.$refs.messengerInput.scrollHeight)
                }
                
                // Partie debounced - s'exécute 500ms après la dernière frappe
                this.debouncedAction(html);
            },
            onPaste(event) {
                let handled = false
                const items = event.clipboardData.items

                for (const item of items) {
                    if (item.type.indexOf('image') !== -1) {
                        const file = item.getAsFile()
                        this.uppy.addFile({
                            name: file.name || `pasted-image-${Date.now()}.png`,
                            type: file.type,
                            data: file,
                        })
                         handled = true
                    }
                }

                if (handled) {
                    event.preventDefault()
                }
            },
            onKeyDown(event) {
               
                if(event.keyCode == 13 && event.shiftKey) {
                    // Shift + Enter : nouvelle ligne
                    this.insertLineBreak();
                } else if(event.key === 'Enter') {
                    // Enter seul : envoyer le message
                    event.preventDefault();
                    this.onSendMessage();
                }

            },
            insertLineBreak() {
                const selection = window.getSelection();
                const range = selection.getRangeAt(0);
                
                // Créer un élément br
                const br = document.createElement('br');
                range.insertNode(br);
                
                // Positionner le curseur après le br
                range.setStartAfter(br);
                range.setEndAfter(br);
                selection.removeAllRanges();
                selection.addRange(range);
                
                // Déclencher l'événement input pour mettre à jour la taille
                this.onInput({ target: this.$refs.messengerInput });
            },
            formatContent(html) {
                 // Regex pour détecter les URLs
                this.urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
                const url = html.match(this.urlRegex) || []

                // TODO Ici votre logique debounced
                console.log('Action debounced avec:', url)
            },
            onRecorded(formData) {
                this.$emit('record-result', formData)
            },
            removeFile(fileId) {
                this.uppy.removeFile(fileId);
            },
            onTextVoiced(transcript) {
               this.message = transcript;
               this.$refs.messengerInput.innerHTML = transcript;
            },
            onDeleteTextearea() {
                this.message = '';
                this.$refs.messengerInput.innerHTML = '';
            },
            updateBreakpoint() {
                this.isLgAndUp = window.innerWidth >= 992
            }
        }
    }
</script>
