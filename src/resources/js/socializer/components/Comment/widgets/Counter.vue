<template>
    <button
        type="button"
        class="comment-counter"
        @click="onLoadComments">
        <IconWidget :icon="currentArrow"></IconWidget>{{ nbCommentsTxt }}
    </button>
</template>

<script>

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: "Counter",
        emits: [
            'load-comments'
        ],
        inject: ["eventBus"],
        components: {
            IconWidget,
        },
        props: {
            nbcomments: {
                type: Number,
                required: true,
            },
            loaded: {
                type: Boolean,
                required: false,
                default: false,
            },
            counterLabel: {
                type: String,
                required: false,
                default: 'Commentaire'
            },
        },
        data() {
            return {
                collapsed : true,
            } 
        },
        computed: {
            nbCommentsTxt: function() {
                const comTxt = this.nbcomments > 1 ? `${this.counterLabel}s` : `${this.counterLabel}`
                return `${this.nbcomments} ${comTxt}`
            },
            currentArrow: function() {
                return this.collapsed ? 'chevron-down' : 'chevron-up'
            }
        },
        watch: {
            loaded() {
               this.collapsed = !this.collapsed
            }
        },
        methods: {
            onLoadComments() {
                
                this.eventBus.$emit("close-comment-form", 'all')

                if(this.loaded) {
                    this.collapsed = !this.collapsed
                } else {
                    this.$emit('load-comments')
                }
            }
        }
    }
</script>
