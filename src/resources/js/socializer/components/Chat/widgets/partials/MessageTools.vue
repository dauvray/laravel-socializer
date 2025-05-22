<template>
 <div class="message-tools" ref="tools"> 
    <div class="d-flex align-items-center text-bg-light border rounded shadow">
        <button type="button" class="btn btn-sm" @click="onSelectedEmoji('👍')">👍</button>
        <button type="button" class="btn btn-sm" @click="onSelectedEmoji('❤️')">❤️</button>
        <button type="button" class="btn btn-sm" @click="onSelectedEmoji('😆')">😆</button>
        <button type="button" class="btn btn-sm" @click="onSelectedEmoji('😲')">😲</button>   
        <EmojBtn 
            :picker-id="`emoji-picker-${message.id}`" 
            @open="onOpenPicker"
            @selected-emoji="onSelectedEmoji"
        ></EmojBtn>
         <div class="vr"></div>
        <button v-if="isMe" type="button" class="btn btn-sm" >
            <IconWidget icon="pen" />
        </button> 
        <div ref="dropdown" 
            class="dropdown"
            @mouseleave="handleCloseDropdown">
            <button class="btn" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                <IconWidget icon="ellipsis-h" />
            </button>
            <ul class="dropdown-menu">
                <li v-if="isMe">
                    <a class="dropdown-item" @click="handleDeleteMessage">
                        <IconWidget icon="trash" /> Supprimer
                    </a>
                </li>
            </ul>
        </div>
    </div>
 </div>
</template>

<script>
    import EmojBtn from '~formdesigner/application/formCreator/widgets/Emoji.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'
    
    export default {
        name: "MessageTools",
        inject: ["eventBus"],
        expose: ['tools'],
        emits: [
            'selected-emoji',
            'delete-message',
        ],
        components: {
            EmojBtn,
            IconWidget,
        },
        props: {
            message: {
                type: Object,
                required: true,
            },
        },
        data() {
            return {
                openPickerId: null,
                pointerEvent: 'auto',
                dropDown: null,
            }
        },
        created() {
            this.eventBus.$on("disable-pointer-event", this.handleOpenPickerEmoji)
            this.eventBus.$on("enable-pointer-event", this.handleClosePickerEmoji)
        },
        mounted() {
            const dropdownToggle = this.$refs.dropdown
            this.dropDown = new bootstrap.Dropdown(dropdownToggle)
        },
        unmounted() {
            this.eventBus.$off("disable-pointer-event", this.handleOpenPickerEmoji)
            this.eventBus.$off("enable-pointer-event", this.handleClosePickerEmoji)
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            isMe: function() {
                return this.message.author.slug === this.me.slug
            },
        },
        methods: {
            onSelectedEmoji(emoji) {
                this.$emit('selected-emoji', emoji)
            },
            onOpenPicker(pickerId) {
                this.openPickerId = pickerId
            },
            handleOpenPickerEmoji(pickerId) {
                if (this.openPickerId !== pickerId) {
                    this.openPickerId = null
                    this.pointerEvent = 'none'
                } else {
                    this.openPickerId = pickerId
                    this.pointerEvent = 'auto'
                }
            },
            handleClosePickerEmoji() {
                this.openPickerId = null
                this.pointerEvent = 'auto'
            },
            handleCloseDropdown() {
                this.dropDown.hide()
            },
            handleOpenDropdown() {
                this.dropDown.show()
            },
            handleDeleteMessage() {
                this.$emit('delete-message', this.message.id)
            },
        }
    }
</script>

<style scoped lang="scss">
    .message-tools {
        position: absolute;
        z-index: 3;
        opacity: 0;
        transform: translateY(30px);
        transition: opacity 0.5s ease, transform 0.5s ease;
        pointer-events: v-bind(pointerEvent);
    }

    .message-tools:hover {
        opacity: 1;
        transform: translateY(20px);
    }
</style>