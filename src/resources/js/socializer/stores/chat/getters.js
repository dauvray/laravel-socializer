export default {

    getCurrentConversation() {
        if(this.currentConversation) {
            return this.currentConversation
        }
       return null
    },
    getCurrentConversationNextUrl() {
        if(this.currentConversation) {
            return this.currentConversation.messages.next_page_url
        }
       return null
    },
    getCurrentConversationId() {
        if(this.currentConversation) {
            return this.currentConversation.general.chat.id
        }
        return null
    },
    getCurrentConversationName() {
        if(this.currentConversation) {
            return this.currentConversation.general.chat.name || this.currentConversation.general.chat.id
        }
        return null
    },
    getCurrentConversationMessages() {
        if(this.currentConversation) {
            return this.messages
        }
        return []
    },
}