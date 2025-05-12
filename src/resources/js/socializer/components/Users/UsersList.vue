<template>
    <ThumbnailUserWidget v-for="user in users"
        :user="user"
    ></ThumbnailUserWidget>
</template>

<script>

    import ThumbnailUserWidget from '~socializer/components/User/ThumbnailWidget.vue'

    export default {
        name: 'UsersList',
        props: {
            users: {
                type: Array,
                required: true
            }
        },
        components: {
            ThumbnailUserWidget,
        }
    }
</script>