<template>
    <ul class="list-unstyled">
        <li v-for="(emoji,idx) in emojis" class="d-inline" :key="idx"> 
            {{ idx }}
            <div v-if="emoji.length > 1">
                {{ emoji.length  }}
            </div>
        </li>
    </ul>
</template>

<script>
    export default {
        name: "MessageEmoji",
        props: {
            emojis: {
                type: Object,
                required: false,
                default: () => {}
            },
        }
    }
</script>