<template>
    <div class="m-3 px-3">
        <ThumbnailUserWidget 
            v-for="user in users" 
            :key="user.slug"
            :user="user"
        ></ThumbnailUserWidget>
    </div>
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