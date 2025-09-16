import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

export default {
    async loadConversations(type = 'contacts') {
        let result = await AjaxService.load(`/load-my-conversations/${type}`)
        this.conversations = result
    },
    addConversation(payload) {
        this.conversations.unshift(payload)
    },
    async createConversation(payload = {}) {
        let result = await AjaxService.load('/create-new-conversations', 'post', payload)

        const chat = {...result.conversation.general.chat}
        this.conversations.push(chat)

        return result.conversation
    },
    async deleteConversation(vertexid) {
        await AjaxService.load(`/delete-conversation/${vertexid}`)
        
        this.conversations = this.conversations.filter( c => {
            return c.id !== vertexid
        })
    },
    async quitConversation(vertexid) {
        await AjaxService.load(`/quit-conversation/${vertexid}`)
        this.conversations = this.conversations.filter( c => {
            return c.id !== vertexid
        })

        if(this.currentConversation && this.currentConversation.id === vertexid) {
            this.currentConversation = null
        }
    },
    updateConversationName(vertexid, title) {
        const conversation = this.conversations.find( c => c.id === vertexid)
        if(conversation) {
            conversation.name = title
        }
    }
}