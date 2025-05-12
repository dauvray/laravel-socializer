import { ref, computed, watch, onUnmounted  } from 'vue'
import { useCommentStore } from '~socializer/stores/comments.js'
import { useLikesStore } from '~socializer/stores/likes.js'

export function useComment(commentable, storeId, nbcomments) {

    const commentStore = useCommentStore()
    const likesStore = useLikesStore()
    const error = ref(null)
    const loading = ref(false)
    const loaded = ref(false)
    const channel = ref(`${storeId}.comment`)

    /*******************************
     * METHODS
     * *****************************/

    const loadComments = async (url = '/get-comments') => {
        loading.value = true

        if(url.includes('/get-comments')) {
            await commentStore.loadComments(url, commentable, storeId)
        } else {
            await commentStore.loadComments(url, storeId, storeId)
        }

        loading.value = false
        loaded.value = true
    }

    const reloadComments = async url => {
        loading.value = true

        await commentStore.reloadComments(url, commentable, storeId)
        
        loading.value = false
        loaded.value = true
    }

    const submitComment = async (url = '/send-comment', payload) => {
       
        let comment

        if(url == '/send-comment') {
            comment = await commentStore.submitComment(url, payload, commentable)
        } else {
            comment = await commentStore.submitComment(url, payload, storeId) 
        }

        return commentStore._insertNewComment(comment, storeId)
    }

    const deleteComment = async (commentId) => {
        commentStore.deleteComment(commentId, storeId)
        .then(() => {
            commentStore._removeComment(commentId, storeId)
        })
    }

    const submitLike = (payload) => {
        likesStore.submitLike(payload, storeId, 'comment')
        .then((likes) => {
            commentStore._updateCommentLikes(likes, payload.itemVid, storeId)
        })
    }

    /*******************************
     * COMPUTED
     * *****************************/

    const comments = computed(() => {
        try {
            return commentStore.commentables[storeId].data
        } catch(e) {
            return []
        }
    })

    const nextUrl = computed(() => {
        if(commentStore.commentables[storeId]) {
            return commentStore.commentables[storeId].next_page_url
        }
        return null
    })

    const total = computed(() => {
        if(commentStore.commentables[storeId]) {
            return commentStore.commentables[storeId].total
        }
        if(nbcomments) {
            return nbcomments
        }
        return null
    })

    /*******************************
     * Watchers
     * *****************************/

    watch(loaded, (val) => {
        if(val) {
            Echo.channel(channel.value)
                // Submit comment
                .listen('.Dauvray\\Socializer\\app\\Events\\CommentCreated', (event) => {
                    commentStore._insertNewComment(event.comment, storeId)
                })
                // Delete comment
                .listen('.Dauvray\\Socializer\\app\\Events\\CommentDeleted', (event) => {
                    commentStore._removeComment(event.comment_id, storeId)
                })
                // likes / dislikes
                .listen('.Dauvray\\Socializer\\app\\Events\\ItemLiked', (event) => {
                    commentStore._updateCommentLikes(event.likes, event.vertexid, event.storeid)
                })
                // increase comment counter
                .listen('.Dauvray\\Socializer\\app\\Events\\CommentCalculated', (event) => {
                    commentStore._updateCommentCounter(event.count, event.vertexid, event.storeid)
                })
        }
    })

    /*******************************
     * LIFE CYCLE
     * *****************************/

    onUnmounted(() =>{
        if(loaded) {
            Echo.leave(channel.value)
        }
    })

    return {
        channel,
        error,
        comments, 
        total,
        loading,
        loaded,
        nextUrl,
        loadComments,
        reloadComments,
        submitComment,
        deleteComment,
        submitLike,
    }
  }