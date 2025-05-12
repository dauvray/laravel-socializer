<template>
    <div v-if="canbereported && logged" class="report">
        <a href="#" class="btn btn-link" @click="sendReport">
            <i class="las la-exclamation-triangle"></i> Signaler
        </a>
    </div>
</template>

<script>

    export default {
        name: 'Report',
        data() {
            return {
            }
        },
        props: {
            item: {
                type: Object,
                required: true
            },
            canbereported: {
                type: Boolean,
                default: false
            },
            logged: {
                type: Boolean,
                default: false
            },
            postreporturl: String,
        },
        methods: {
            async sendReport(){
                const data = {
                    'id': this.item.id,
                    'type': this.item.type,
                }

                let response = await axios({
                    url: this.postreporturl,
                    method: 'post',
                    data: data
                })
            }
        }
    }
</script>
