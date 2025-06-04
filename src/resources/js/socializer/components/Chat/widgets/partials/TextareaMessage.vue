<template>
    <div class="message-input-container">
        <div class="flex-grow-1 h-100">
            <Wysiwyg
                v-if="wysiwyg"
                v-model:content="message"
            ></Wysiwyg>
            <div
                v-else
                id="auto-growing-textarea" 
                ref="messengerInput"
                contenteditable="true" 
                class="message-input"
                @keydown="onKeyDown"
                @focus="onStartWritting"
                @blur="onStopWritting"
                @input="onInput">
            </div>
        </div>
        
        <div class="message-input-tools">
            <MessageToolsButtons
                icon-color="text-light"
                @selected-emoji="onSelectedEmoji"
                @open-wysiwyg="onWysiwyg"
            ></MessageToolsButtons>
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
    import MessageToolsButtons from '~socializer/components/Chat/widgets/partials/MessageToolsButtons.vue'
    import { defineAsyncComponent } from '@vue/runtime-core'
   
    export default {
        name: 'TextareaMessage',
        inject: ["eventBus"],
        components: {
            IconWidget,
            MessageToolsButtons,
            Wysiwyg:  defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/atoms/Wysiwyg.vue')),
        },
        emits: [
            'start-writting',
            'stop-writting',
            'send-message',
            'open-wysiwyg',
        ],
        data() {
            return {
                message: '',
                wysiwyg: false,
            };
        },
        mounted() {
            
        },
        unmounted() {

        },
        watch: {
            message: function() {
               this.onInput();
            },
        },
        computed: {
            isDirty: function() {
                return this.message.trim() !== '';
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
                } else {
                    this.$emit('send-message', this.message)
                    this.message = ''
                    this.wysiwyg = false
                }
                
                
                // Réinitialiser la taille après l'envoi
                // this.$nextTick(() => {
                //     this.autoResize();
                // });
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
            onWysiwyg() {
                if (!this.wysiwyg) {
                   this.message = this.$refs.messengerInput.innerHTML
                   this.eventBus.$emit("disable-pointer-event", 'messenger-wysiwyg')
                   this.wysiwyg = true
                } else {
                    this.wysiwyg = false
                    setTimeout(() => {
                         this.$refs.messengerInput.innerHTML = this.message
                        //  this.$nextTick(() => {
                        //      this.autoResize();
                        //  });
                    }, 100)
                    this.eventBus.$emit("enable-pointer-event")
                }
                 this.$emit('open-wysiwyg', this.wysiwyg)
            },
            onInput(event) {
                let html
                if(event) {
                    html = event.target.innerHTML.trim();
                } else {
                    html = this.message.trim();
                }
               
                
                // Filtrer les faux contenus vides
                if (html === '<br>' || html === '&nbsp;' || html === '') {
                    this.message = '';
                } else {
                    this.message = html;
                }
                
                // Auto-redimensionner après chaque modification
                // this.$nextTick(() => {
                //     this.autoResize();
                // });
            },
            updateElHeight(width) {
              this.ElHeight = width
            },
            onKeyDown(event) {
                if (event.key === 'Enter') {
                    if (event.shiftKey) {
                        // Shift + Enter : nouvelle ligne
                        event.preventDefault();
                        this.insertLineBreak();
                    } else {
                        // Enter seul : envoyer le message
                        event.preventDefault();
                        this.onSendMessage();
                    }
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
            // autoResize() {
            //     const element = this.$refs.messengerInput;
            //     if (!element) return;
                
            //     // Réinitialiser la hauteur pour obtenir la hauteur de contenu réelle
            //     element.style.height = 'auto';
                
            //     // Calculer la nouvelle hauteur basée sur le contenu
            //     const scrollHeight = element.scrollHeight;
                
            //     // Appliquer la nouvelle hauteur
            //     element.style.height = scrollHeight + 'px';
            // },
        }
    }
</script>
