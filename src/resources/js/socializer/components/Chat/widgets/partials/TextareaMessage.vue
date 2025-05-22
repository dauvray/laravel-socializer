<template>
    <div class="message-input-container">
        <div class="flex-grow-1">

            <Wysiwyg
                v-if="wysiwyg"
                v-model:content="message"
            ></Wysiwyg>

            <div
                v-else
                id="auto-growing-textarea" 
                ref="messengerInput"
                v-html="message"
                contenteditable="true" 
                class="message-input"
                @focus="onStartWritting"
                @blur="onStopWritting">
            </div>
        </div>
        
        <div class="message-input-tools">
            <button type="button" class="btn btn-link" title="Formatage" @click="onWysiwyg">
                <IconWidget icon="pen-alt"></IconWidget>
            </button>
            <EmojBtn 
                btn-class="btn btn-link"
                @selected-emoji="onSelectedEmoji"
            ></EmojBtn>
            <div class="vr"></div>
            <button type="button" class="btn btn-link" title="Envoyer" id="sendButton" @click="onSendMessage">
                <IconWidget icon="paper-plane"></IconWidget>
            </button>
        </div>
    </div>
</template>

<script>

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import EmojBtn from '~formdesigner/application/formCreator/widgets/Emoji.vue'
    import { defineAsyncComponent } from '@vue/runtime-core'


    export default {
        name: 'TextareaMessage',
        inject: ["eventBus"],
        components: {
            IconWidget,
            EmojBtn,
            Wysiwyg:  defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/atoms/Wysiwyg.vue')),
        },
        emits: [
            'start-writting',
            'stop-writting',
            'send-message',
        ],
        data() {
            return {
                message: '',
                wysiwyg: false,
            };
        },
        mounted() {
           document.addEventListener('DOMContentLoaded', function() {
            // Utiliser un élément contenteditable au lieu d'un textarea
            const editableDiv = document.getElementById('auto-growing-textarea');
            const sendButton = document.getElementById('sendButton');
            
            // Afficher le placeholder
            const placeholder = editableDiv.getAttribute('data-placeholder');
            editableDiv.innerHTML = '';
            editableDiv.addEventListener('focus', function() {
                if (this.innerHTML === placeholder) {
                    this.innerHTML = '';
                }
            });
            
            editableDiv.addEventListener('blur', function() {
                if (this.innerHTML === '' || this.innerHTML === '<br>') {
                    this.innerHTML = placeholder;
                }
            });
            
            // Simuler un placeholder
            if (editableDiv.innerHTML === '') {
                editableDiv.innerHTML = placeholder;
            }
            
            // Limiter la hauteur et ajouter des scrollbars si nécessaire
            function checkHeight() {
                if (editableDiv.scrollHeight > 150) {
                    editableDiv.style.overflowY = 'auto';
                } else {
                    editableDiv.style.overflowY = 'hidden';
                }
            }
            
            // Observer les changements de contenu
            new MutationObserver(checkHeight).observe(editableDiv, {
                childList: true,
                characterData: true,
                subtree: true
            });
            
            // Gérer l'événement keydown pour capturer Shift+Enter vs Enter
            editableDiv.addEventListener('keydown', function(event) {
                if (event.key === 'Enter') {
                    if (event.shiftKey) {
                        // Permettre le saut de ligne avec Shift+Enter
                        // Le comportement par défaut de contenteditable gère cela
                        setTimeout(checkHeight, 0);
                    } else {
                        // Empêcher le comportement par défaut d'Enter (nouveau paragraphe)
                        event.preventDefault();
                        
                        const messageContent = editableDiv.innerText.trim();
                        if (messageContent && messageContent !== placeholder) {
                            // Simuler l'envoi du message
                            console.log('Message envoyé:', messageContent);
                            
                            // Dans votre composant Vue, vous gérerez l'envoi
                            // et la réinitialisation du champ
                            
                            // Effet visuel sur le bouton d'envoi
                            sendButton.classList.add('text-primary');
                            setTimeout(() => {
                                sendButton.classList.remove('text-primary');
                            }, 150);
                        }
                    }
                }
            });
            
            // Simuler l'envoi du message lors du clic sur le bouton d'envoi
            sendButton.addEventListener('click', function() {
                const messageContent = editableDiv.innerText.trim();
                if (messageContent && messageContent !== placeholder) {
                    console.log('Message envoyé:', messageContent);
                    // Vous implémenterez la logique réelle dans votre composant Vue
                }
            });
            
            // Vérifier la hauteur initiale
            checkHeight();
        });
        },
        unmounted() {

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
                 } else {
                    this.$emit('send-message', this.message)
                    this.wysiwyg = false
                 }
                this.message = ''
                this.$refs.messengerInput.innerHTML = ''
            },
            onSelectedEmoji(emoji) {
                 if (!this.wysiwyg) {
                    this.$refs.messengerInput.append(emoji)
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
                    }, 100)
                    this.eventBus.$emit("enable-pointer-event")
                }
            }
        }
    }
</script>
