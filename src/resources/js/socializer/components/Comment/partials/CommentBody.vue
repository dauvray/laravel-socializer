<template>
    <div class="card-text" v-html="item.content"></div>
</template>

<script>
export default {
    name: "CommentBody",
    props: {
        item: {
            type: Object,
            required: true
        }
    }
}
</script>
