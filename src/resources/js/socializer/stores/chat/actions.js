import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

export default {
    async loadConversation(vertexid, nextPageURL = null) {
        if(nextPageURL) {
            this.currentConversation = await AjaxService.load(nextPageURL)
        } else {
            this.currentConversation = await AjaxService.load(`/load-conversation/${vertexid}`)
        }
        
        this.messages = this.currentConversation.messages.data.slice().reverse().concat(this.messages)
    },
    resetConversation() {
        this.$reset()
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
        let result = await AjaxService.load(`/delete-conversation/${vertexid}`)
        
       this.conversations = this.conversations.filter( c => {
        return c.id !== vertexid
       })
    },
    async quitConversation(vertexid) {
        let result = await AjaxService.load(`/quit-conversation/${vertexid}`)
        this.conversations = this.conversations.filter( c => {
            return c.id !== vertexid
        })
    },
    updateConversationInfos(payload) {
        this.currentConversation.general = {...payload}
    },
    leaveCurrentConversation() {
        this.currentConversation = null
    },
    async addContactToConversation(identifier, vertexid) {
        AjaxService.load('/add-contact-to-conversation', 'post', {
            contact: identifier,
            chat: vertexid,
        })
    },
    sendMessage(payload) {
        AjaxService.load(
            '/send-chat-message', 
            'post', 
            { 
                message: payload.message,
                room_id: payload.chatId,
            },
            {
                err: null, msg: null, options: null
            },
            {
                'X-Socket-ID': Echo.socketId()
            }
        )
    },
    receiveMessage(payload) {
        this.messages.push(payload)
    },
}