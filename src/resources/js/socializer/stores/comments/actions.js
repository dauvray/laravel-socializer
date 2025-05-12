import { useAjaxService } from '~estarter/services/AjaxService.js'
import { isEmpty } from '~estarter/services/helpers.js'

const AjaxService = useAjaxService()

const commentTemplate = {
    data: [],
    total: 0,
    current_page: 1,
}

export default {
    /*__________________________________________
    |
    | COMMENTS
    |_________________________________________*/

    async loadComments(url = '/get-comments', commentable, storeId) {
        let response = await AjaxService.load(url, 'post', { commentable, order: this.sortBy })

        // first loading page or commented but not even loaded
        if(!this.commentables.hasOwnProperty(storeId) || !this.commentables[storeId].hasOwnProperty('from') ) {
            this.commentables[storeId] = response
        } else {
            const data = [...this.commentables[storeId].data]
            this.commentables[storeId] = response
            this.commentables[storeId].data = [...data, ...response.data]
        }
    },
    reloadComments(url = '/get-comments', commentable, storeId) {
        this.commentables = {}
        this.loadComments(url, commentable, storeId)
    },
    resetComments() {
        this.commentables = {}
    },
    async submitComment(url = '/send-comment', payload, commentable) {

       const comment = await AjaxService.load(
            url, 
            'post', 
            {
                ...payload,
                commentable
            },
            {
                err: null, msg: null, options: null
            },
            {
                'X-Socket-ID': Echo.socketId()
            }
        )

        return comment
    },
    async deleteComment(comment_id, commentable) {
        const result = await AjaxService.load(
            `/delete-comment`,
            'post',
            {
                comment_id,
                commentable 
            },
            {err: null, msg: null, options: null},
            {
                'X-Socket-ID': Echo.socketId()
            }
        )

        return result
    },
    setSortbyFilter(filter) {
        this.sortBy = filter
    },
    _insertNewComment(comment, storeId) {

        if(!this.commentables.hasOwnProperty(storeId)) {
            this.commentables[storeId] = {...commentTemplate}
        }

        // Clonage profond du commentaire pour éviter les effets de bord
        const newComment = JSON.parse(JSON.stringify(comment));

        // format identifiers
        const store = isEmpty(newComment.store) ? newComment.parent : newComment.store
        const parent = isEmpty(newComment.store) ? newComment.comment.id : newComment.parent

        this.commentables[storeId].data = [newComment, ...this.commentables[storeId].data]
        this.commentables[storeId].total++

        // update counter
        if(store !== storeId) {
            this.commentables[store].data.forEach((item, idx) => {
                if(parent == item.comment.id) {
                    this.$patch((state) => {
                        state.commentables[store].data[idx].count++
                    })
                }
            })
        }

        return newComment
    },
    _removeComment(commentId, storeId) {

        const removeCommentAndChildren = (commentId, storeId) => {

            if (!this.commentables[storeId]) return

            const commentIndex = this.commentables[storeId].data.findIndex(c => c.comment.id === commentId)
            if (commentIndex === -1) return

            const comment = this.commentables[storeId].data[commentIndex]

            // Supprimer les sous-commentaires récursivement
            if (this.commentables[comment.comment.id]) {
                const childStoreId = comment.comment.id
                this.commentables[childStoreId].data.forEach(child => {
                    removeCommentAndChildren(child.comment.id, childStoreId)
                })
                // Supprimer le store enfant une fois qu'il est vide
                delete this.commentables[childStoreId]
            }

            // format identifiers
            const store = isEmpty(comment.store) ? comment.parent : comment.store
            const parent = isEmpty(comment.store) ? comment.parent : comment.parent

            // Supprimer le commentaire de son store 
            this.commentables[parent].data.splice(commentIndex, 1)
            this.commentables[parent].total--
            if (this.commentables[parent].total === 0) {
                delete this.commentables[parent]
            }

            // update parent counter
            if(this.commentables.hasOwnProperty(store)) {
                this.commentables[store].data.forEach((item, idx) => {
                    if(parent == item.comment.id) {
                        this.commentables[store].data[idx].count--
                    }
                })

            // if (commentStore.data.length === 0) {
            //     delete this.commentables[storeId]
            // }
            }
        }

        removeCommentAndChildren(commentId, storeId)
    },
    _updateCommentCounter(total, commentId, storeId) {
        this.commentables[storeId].data.forEach((comment, idx) => {
            if(comment.comment.id == commentId) {
                this.commentables[storeId].data[idx].count = total
            }
        })
    },

    /*__________________________________________
    |
    | LIKES
    |_________________________________________*/

    _updateCommentLikes(payload, commentId, storeId) {
        this.commentables[storeId].data.forEach((comment, idx) => {
            if(comment.comment.id == commentId) {
                this.commentables[storeId].data[idx].likes = payload.likes
                this.commentables[storeId].data[idx].dislikes = payload.dislikes
            }
        })
    },

}
