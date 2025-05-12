<template>
    <template v-if="pagination">
        <PaginationWidget
            v-if="paginator"
            :paginator="paginator"
            @load-page="onLoadPagination"
        ></PaginationWidget>
    </template>
    <IntersectionObserver
        v-else
        @trigger-intersected="onTriggerObserver"
    ></IntersectionObserver>
</template>

<script>

    import PaginationWidget from '~estarter/components/widgets/Pagination.vue'
    import IntersectionObserver from '~socializer/components/widgets/IntersectionObserver.vue'
    
    export default {
        name: 'PaginationOrIntersection',
        emits: [
            'load-page',
            'trigger-intersected',
        ],
        components : {
            IntersectionObserver,
            PaginationWidget,
        },
        props: {
            pagination: {
                type: Boolean,
                required: false,
                default: false,   
            },
            paginator: {
                type: Object,
                required: false,
            },
        },
        methods: {
            onLoadPagination(url) {
                this.$emit('load-page', url)
            },
            onTriggerObserver() {
                this.$emit('trigger-intersected')
            }
        }
    }
</script>