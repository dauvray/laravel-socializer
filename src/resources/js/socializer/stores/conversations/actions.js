import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

export default {
    async loadConversations() {
        let result = await AjaxService.load('/load-my-conversations')
        this.conversations = result
    },
    addConversation(payload) {
        this.conversations.unshift(payload)
    },
    async createConversation() {
        let result = await AjaxService.load('/create-new-conversations')

        const chat = {
            id: result.id,
            image: null,
            name: null,
        }

        this.conversations.push(chat)

        return chat
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
}