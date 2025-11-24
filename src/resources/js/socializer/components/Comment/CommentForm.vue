<template>
    <div class="comment-form-wrapper">
        <button 
            v-if="!showForm && displayCommentBtn"
            type="button"
            class="btn"
            @click="onShowCommentForm">
            <IconWidget icon="comments"></IconWidget> {{ btnLabel }}
        </button>
        <template v-if="showForm" >
            <form 
                class="comment-form-inner"
                v-on:submit.prevent>
                <div class="d-flex w-100">
                    <label for="textComment" class="m-2">Votre commentaire</label>
                    <div class="flex-grow-1">
                        <button
                            type="button" 
                            class="btn btn-link float-end" 
                            aria-label="Fermer"
                            @click="onShowCommentForm">
                            <IconWidget icon="window-close"></IconWidget> Fermer
                        </button>
                    </div>
                </div>
                <textarea
                    class="form-control"
                    ref="input"
                    rows="3"
                    id="textComment"
                    :autofocus="true"
                    :maxlength="max"
                    v-model="content"
                ></textarea>
                <div class="d-flex align-items-center">
                    <EmojiBtn 
                        class="mt-2 me-2"
                        btnClass="btn btn-outline-primary btn-sm"
                        @selected-emoji="onSelectedEmoji"
                    ></EmojiBtn>
                    <small id="length_comment" class="form-text text-muted">
                        {{ max - content.length }} caractères restants
                    </small>
                    <div class="flex-grow-1">
                        <div v-if="content.length"
                            class="btn-group float-end mt-2" 
                            role="group" >
                            <button
                                type="buttton"
                                class="btn btn-secondary btn-sm"
                                @click="onCancelSubmitComment"
                            >Annuler</button>
                            <button
                                type="buttton"
                                class="btn btn-primary btn-sm"
                                @click="onSubmitComment"
                            >Envoyer</button>
                        </div>
                    </div>
                </div>
            </form>
        </template>
    </div>
</template>

<script>

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { uniqueId } from '~estarter/services/helpers.js'
    import { defineAsyncComponent } from 'vue'

    export default {
        name: 'CommentForm',
        inject: ["eventBus"],
        components: {
            IconWidget,
            EmojiBtn: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/Emoji.vue')),
        },
        emits: [
            'cancel-submit-comment',
            'submit-comment',
            'signal-form-uniqid',
        ],
        data() {
            return {
                uniqid: uniqueId('com-form'),
                showForm: false,
                content: '',
                max: 500,
                min: 10,
            }
        },
        props: {
            autofocus: {
                type: Boolean,
                required: false,
                default: true
            },
            btnLabel: {
                type: String,
                required: false,
                default: 'Commenter'
            },
            displayCommentBtn: {
                type: Boolean,
                required: false,
                default: true
            },
        },
        created() {
            this.eventBus.$on("close-comment-form", this.handleCloseReactFrom)

            if(!this.displayCommentBtn){
                this.eventBus.$on("open-comment-form", this.handleOpenReactFrom)
            }

            this.$emit('signal-form-uniqid', this.uniqid)
        },
        mounted() {
            if(this.showForm){
                this.$refs.input.focus()
            }

            window.addEventListener('keydown', this.onKeydown);
        },
        unmounted() {
            this.eventBus.$off("close-comment-form", this.handleCloseReactFrom)
            if(!this.displayCommentBtn){
                this.eventBus.$off("open-comment-form", this.handleOpenReactFrom)
            }
            window.removeEventListener('keydown', this.onKeydown);
        },
        methods: {
            onShowCommentForm() {
                this.showForm = !this.showForm
                if(this.showForm) {
                    setTimeout(() => {
                        this.$refs.input.focus()
                    }, 100)
                    this.eventBus.$emit("close-comment-form", this.uniqid)
                } else {
                    this.clearContent()
                }
            },
            onCancelSubmitComment() {
                this.clearContent()
                this.$emit('cancel-submit-comment')
            },
            handleCloseReactFrom(formId) {
                if(formId != this.uniqid) {
                    this.showForm = false
                    this.clearContent()
                }
            },
            handleOpenReactFrom(formId) {
                if(formId == this.uniqid) {
                    this.onShowCommentForm()
                }
            },
            onSubmitComment() {
                this.$emit('submit-comment', {
                    comment: this.content
                })
                this.onShowCommentForm()
                this.clearContent()
            },
            onSelectedEmoji(emoji) {
                this.content += emoji
            },
            clearContent() {
                this.content = ''
            },
            onKeydown(event) {
                if (event.key === "Escape" && this.showForm) {
                    this.onShowCommentForm()
                }
            },
        }
    }
</script>

