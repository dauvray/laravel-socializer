import { isEmpty } from '~estarter/services/helpers.js'

export default {
    getCommentables() {
        return this.commentables
    },
    hasComments() {
        return !isEmpty(this.commentables)
    },
    findCommentable:(state) => {
        return (storeId) => { 
            return state.commentables[storeId]
        }
    },
    getSortBy() {
        return this.sortBy
    },
}