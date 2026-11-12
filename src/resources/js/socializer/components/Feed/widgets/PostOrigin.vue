<template>
    <div>{{ breadcrumbs }}</div>
</template>

<script>

export default {
    name: 'PostOrigin',
    props: {
        breadcrumbs : {
            type: String,
            required: true
        }
    }
}
</script>