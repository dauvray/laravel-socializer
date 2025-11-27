<template>
    <div role="group" aria-label="like buttons">
        <button type="button" 
            class="btn thumbs-up-btn"
            :disabled="this.me ? false: true"
            :aria-disabled="this.me ? false: true"
            @click="onLike">
            <IconWidget icon="thumbs-up"></IconWidget> {{ likes }}
        </button>
        <button type="button" 
            class="btn thumbs-down-btn"
            :disabled="this.me ? false: true"
            :aria-disabled="this.me ? false: true"
            @click="onDislike">
            <IconWidget icon="thumbs-down"></IconWidget> {{ dislikes }}
        </button>
    </div>
</template>

<script>

    import { mapState } from 'pinia'
    import { useMeStore } from '~estarter/stores/me.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'Like',
        emits: [
            'like-item',
        ],
        components: {
            IconWidget,
        },
        props: {
            likes: {
                type: Number,
                required: true,
                default: 0
            },
            dislikes: {
                type: Number,
                required: true,
                default: 0
            },
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
        },
        methods: {
            onLike() {
               this.$emit('like-item', true)
            },
            onDislike() {
                this.$emit('like-item', false)
            },
        }
    }
</script>

