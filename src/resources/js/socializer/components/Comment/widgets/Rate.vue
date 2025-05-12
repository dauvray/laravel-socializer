<template>
    <div class="rating d-flex" v-if="canberated">
        <star-rating
            :read-only="readOnly"
            :show-rating="false"
            :rating="ratingValue"
            :star-size="15"
            @rating-selected ="sendRating"
        ></star-rating>
        <div v-if="showcounter">
            <span class="rate-text">sur {{ this.ratable.average_count }} votes</span>
        </div>
    </div>
</template>

<script>

    export default {
        name: 'Rate',
        components: {
            StarRating: () => import('vue-star-rating')
        },
        data() {
            return {}
        },
        props: {
            ratable: {
                type: Object,
                required: false
            },
            readOnly: {
                type: Boolean,
                default: true
            },
            canberated: {
                type: Boolean,
                default: true
            },
            showcounter: {
                type: Boolean,
                default: false
            }
        },
        methods: {
            sendRating(rating) {
                this.$emit('rating-selected', rating)
            }
        },
        computed: {
            ratingValue: function () {
                if(this.readOnly) {
                    return this.ratable.rating || this.ratable.average_rate
                } else {
                    return 0
                }
            }
        }
    }
</script>

<style lang="scss" scoped>
    .rate-text{
        padding-left: 5px;
    }
</style>
