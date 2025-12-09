<template>
    <button
        type="button"
        class="comment-counter"
        @click="onDisplayComments">
        <IconWidget icon="comments" class="icon"></IconWidget>{{ nbCommentsTxt }}
        <IconWidget :icon="currentArrow" class="icon"></IconWidget>
    </button>
</template>

<script>

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: "Counter",
        emits: [
            'display-comments'
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
            collapsed: {
                type: Boolean,
                required: false,
                default: true,
            },
            counterLabel: {
                type: String,
                required: false,
                default: 'Commentaire'
            },
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
        methods: {
            onDisplayComments() {
                this.eventBus.$emit("close-comment-form", 'all')
                this.$emit('display-comments')
            }
        }
    }
</script>
