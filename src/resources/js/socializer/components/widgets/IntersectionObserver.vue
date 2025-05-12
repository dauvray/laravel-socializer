<template>
     <span ref="trigger"></span>
</template>

<script>
    export default {
        name: 'IntersectionObserver',
        emits: [
            'trigger-intersected',
        ],
        props: {
            options: {
                type: Object,
                required: false,
                default: {
                    root: null,
                    threshold: 0
                }
            }
        },
        data() {
            return {
                observer: null,
            }
        },
        mounted() {
            this.observer = new IntersectionObserver( this.onHandleIntersect, this.options)
            this.observer.observe(this.$refs.trigger)
        },
        unmounted() {
            this.observer.disconnect();
        },
        methods: {
            onHandleIntersect(entries, observer) {
                entries.forEach((entry) => {
                    if(entry.isIntersecting) {
                        this.$emit('trigger-intersected')
                    }
                });
            },
        }
    }
</script>