<template>
    <div class="comments-filter">
        <div class="btn-group btn-group-sm" role="group" aria-label="sort comments">
            <button 
                type="button" 
                class="btn btn-outline-secondary btn-sm"
                :class="{ active: sortBy == 'likes DESC' }"
                @click="setSortByFilter('likes DESC')"
                >Top
            </button>
            <button 
                type="button" 
                class="btn btn-outline-secondary btn-sm" 
                :class="{ active: sortBy == 'createdAT DESC' }"
                @click="setSortByFilter('createdAT DESC')"
                >+ récents
            </button>
            <button 
                type="button" 
                class="btn btn-outline-secondary btn-sm"
                :class="{ active: sortBy == 'createdAT ASC' }"
                 @click="setSortByFilter('createdAT ASC')"
                >- récents
            </button>
            <button 
                v-if="me"
                type="button" 
                class="btn btn-outline-secondary btn-sm"
                :class="{ active: sortBy == 'mine' }"
                 @click="setSortByFilter('mine')"
                >Mes commentaires
            </button>
        </div>
    </div>

</template>

<script>
    import { useCommentStore } from '~socializer/stores/comments.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapActions,mapState } from 'pinia'

    export default {
        name: 'CommentsFilter',
        props: {
            commentable: {
                type: String,
                required: true,
            },
            vertexid: {
                type: String,
                required: true,
            },
        },
        computed: {
            ...mapState(useCommentStore, {
                sortBy: 'getSortBy',
            }),
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
        },
        methods: {
            ...mapActions(useCommentStore, [
                'setSortbyFilter',
                'reloadComments',
            ]),
            setSortByFilter(filter) {
                if(filter != this.sortBy) {
                    this.setSortbyFilter(filter)
                    this.reloadComments('/get-comments', this.commentable, this.vertexid)
                }
            }
        }
    }
</script>