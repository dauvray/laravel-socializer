<template>
    <div class="card p-2 mt-2">
        <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" role="switch" id="flexSwitchCheckDefault" v-model="showWhiteboard">
            <label class="form-check-label" for="flexSwitchCheckDefault">Tableau blanc</label>
        </div>
        <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" role="switch" id="flexSwitchCheckDefault" v-model="showChat">
            <label class="form-check-label" for="flexSwitchCheckDefault">Chat</label>
        </div>
    </div>
</template>

<script>
    export default {
        name: 'ConfigPanel',
        emits: [
            'show-whiteboard',
            'show-chat',
        ],
        props : {
            whiteBoard: {
                type: Boolean,
                required: false,
                default: false,
            },
            chat: {
                type: Boolean,
                required: false,
                default: false,
            },
        },
        computed: {
            showWhiteboard: {
                get() {
                    return this.whiteBoard
                },
                set(value) {
                    this.$emit('show-whiteboard', value)
                }
            },
            showChat: {
                get() {
                    return this.chat
                },
                set(value) {
                    this.$emit('show-chat', value)
                }
            },
        }
    }
</script>