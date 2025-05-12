export default {
    getPostFeed() {
        if(this.posts) {
            return this.posts.data
        }
       return []
    },
    getPaginator() {
        return this.posts
    }
}