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
    sendEmoji(payload) { 
        AjaxService.load(
            '/send-chat-emoji', 
            'post', 
            { 
                emoji: payload.emoji,
                room_id: payload.chatId,
                message_id: payload.messageId,
                from: payload.from,
            },
            {
                err: null, msg: null, options: null
            },
            {
                'X-Socket-ID': Echo.socketId()
            }
        )
    },
    receiveEmoji(payload) {
       this.messages.forEach(message => {
            if (message.id === payload.vertexid) {
                if(!message.extras.hasOwnProperty('emojis')) {
                    message.extras.emojis = {}
                }
                message.extras.emojis = {...payload.emojis}
            }
        }) 
    },
    deleteMessage(payload) {
        AjaxService.load(
            '/delete-chat-message', 
            'post', 
            { 
                room_id: payload.chatId,
                message_id: payload.messageId,
            },
            {
                err: null, msg: null, options: null
            },
            {
                'X-Socket-ID': Echo.socketId()
            }
        )
    },
    deletedMessage(vertexid) { 
        this.messages = this.messages.filter( m => {
            return m.id !== vertexid
        })
    },
    updateMessage(payload) {
        AjaxService.load(
            '/update-chat-message', 
            'post', 
            { 
                message: payload.message,
                message_id: payload.messageId,
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
    updatedMessage(payload) {
        let index = null

        this.messages.forEach((message, idx) => {
            if (message.id === payload.id) {
                index = idx
            }
        })
        if(index) {
            this.messages.splice(index, 1, payload)
        }
    },
}