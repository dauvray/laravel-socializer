<template>
    <button 
        v-if="!showForm"
        type="button"
        class="btn"
        @click="onShowCommentForm">
        <IconWidget icon="comments"></IconWidget> {{ btnLabel }}
    </button>
    <template v-else >
        <form 
            class="comment-form-wrapper" 
            v-on:submit.prevent>
            <div class="d-flex w-100">
                <label for="textComment">Votre commentaire</label>
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
            }
        },
        created() {
            this.eventBus.$on("close-comment-form", this.handleCloseReactFrom)
        },
        mounted() {
            if(this.showForm){
                this.$refs.input.focus()
            }

            window.addEventListener('keydown', this.onKeydown);
        },
        unmounted() {
            this.eventBus.$off("close-comment-form", this.handleCloseReactFrom)
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

<style lang="scss" scoped>
    .comment-form-wrapper{
        margin-bottom: 20px;
    }
</style>
