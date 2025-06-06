<template>
    <ul class="emoji-list">
        <li v-for="(emoji,idx) in emojis" :key="idx"> 
            {{ idx }}
            <span v-if="emoji.length > 1">
                {{ emoji.length  }}
            </span>
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