import { useAjaxService } from '~estarter/services/AjaxService.js'
import { useCommentStore } from '~socializer/stores/comments.js'
import { isEmpty } from '~estarter/services/helpers.js'

const AjaxService = useAjaxService()
const commentStore = useCommentStore()

export default {
    async loadFeed(identifier, type='wall') {
        const feed = await AjaxService.load(`/owner-${type}/${identifier}`)
        this.feedId = feed.id
        this.initListeners()
        return feed
    },
    async loadFeedPost(feedId) {
        const feed = await AjaxService.load(`/get-feed-posts/${feedId}`)
        this.posts = feed
    },
    initListeners() {
        Echo.channel(`${this.feedId}.feed`)
        // Feed activity
        .listen('.Dauvray\\Socializer\\app\\Events\\FeedActivity', (event) => {
           this.manageFeedActivity(event)
        })
        // Submit post
        .listen('.Dauvray\\Socializer\\app\\Events\\PostCreated', (event) => {
            this.insertPost(event.post)
        })
        // Delete post
        .listen('.Dauvray\\Socializer\\app\\Events\\PostDeleted', (event) => {
            this.removePost(event.post_id)
        })
        // likes / dislikes
        .listen('.Dauvray\\Socializer\\app\\Events\\ItemLiked', (event) => {
            this.updatePostLikes(event.likes, event.vertexid, event.storeid)
        })
    },
    resetFeed() {
        this.$reset()
    },
    async deleteFeedPost(postId, feedId) {
        const result = await AjaxService.load(
            `/delete-feed-post`,
            'post',
            {
                post_id: postId,
                feed_id: feedId,
            },
            {err: null, msg: null, options: null},
            {
                'X-Socket-ID': Echo.socketId()
            }
        )

        return result
    },
    removePost(postId) {
        this.posts.data = this.posts.data.filter( element => {
            return element.post.id != postId
        })
    },
    async sendFeedPost(formData) {
        const post = AjaxService.load(
            '/send-feed-post',
            'post',
            formData,
            {
                err: null, msg: null, options: null
            },
            {
                'X-Socket-ID': Echo.socketId()
            }
        )

        return post
    },
    insertPost(post) {
        // Clonage profond du commentaire pour éviter les effets de bord
        const newPost = JSON.parse(JSON.stringify(post));
        if(!this.posts.data.find(item => item.post.id === newPost.post.id)){
            this.posts.data.splice(0, 0, newPost)
            this.posts.total++
        }
    },
    async sharePost(postVid, feedVid) {

        const share = await AjaxService.load(
            `/share-feed-post`,
            'post',
            {
                post_vid: postVid,
                feed_vid: feedVid,
            },
            {err: null, msg: null, options: null},
            {
                'X-Socket-ID': Echo.socketId()
            }
        )

        return share.data
    },
    setSharedPost(post) {
        this.posts.data.forEach((element, idx) => {
            if(element.post.vertexid == post.post.vertexid) {
                this.posts.data.splice(idx, 1, post);
            }
        })
    },

    /*__________________________________________
    |
    | LIKES
    |_________________________________________*/

    updatePostLikes(payload, postId, feedId) {
        this.posts.data.forEach((post, idx) => {
            if(post.post.vertexid == postId) {
                this.posts.data[idx].post.likes = payload.likes
                this.posts.data[idx].post.dislikes = payload.dislikes
            }
        })
    },

    /*-----------------------------------------
    | TRIGGERS
    |-----------------------------------------*/
    async triggerFeedActivity(payload) {
        const response = await AjaxService.load(
            '/trigger-feed-activity', 
            'post', 
            payload,
            {err: null, msg: null, options: null},
            {
                'X-Socket-ID': Echo.socketId()
            }
        )
    },
    manageFeedActivity(trigger) {
        switch(trigger.activity.action) {
            case 'comment.created':
                this.commentCreatedTrigger(trigger.activity.element)
                break
            case 'comment.deleted':
                this.commentDeletedTrigger(trigger.activity.element)
                break
        }
    },

    // todo : voir si necessaire
    // peut etre que quand les commentaires ne sont pas chargés
    // ça n'écoute pas
    commentCreatedTrigger(element) {
        // is post comment ?
        if(isEmpty(element.store)) {
            this.posts.data.forEach((item, idx) => {
                if(item.post.vertexid == element.parent) {
                    this.posts.data[idx].post.nb_comments++
                }
            })
        } else { // is sub-comment
            commentStore.commentables[element.store].data.forEach((item, idx) => {
                if(item.comment.id == element.parent) {
                    commentStore.commentables[element.store].data[idx].count++
                }
            })
        }
    },
    commentDeletedTrigger(element) {
        if(isEmpty(element.store)) {
            this.posts.data.forEach((item, idx) => {
                if(item.post.vertexid == element.parent) {
                    this.posts.data[idx].post.nb_comments--
                }
            })
        } else { // is sub-comment
            commentStore.commentables[element.store].data.forEach((item, idx) => {
                if(item.comment.id == element.parent) {
                    commentStore.commentables[element.store].data[idx].count--
                }
            })
        }
    }
}