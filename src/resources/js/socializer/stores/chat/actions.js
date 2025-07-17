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
    async resetConversation() {
        this.$reset()
    },
    leaveCurrentConversation() {
        this.currentConversation = null
    },
    setCurrentConversation(conversation) {
        this.currentConversation = {...conversation}
    },
    updateConversationInfos(payload) {
        this.currentConversation.general = {...payload}
    },
    async addContactToConversation(identifier, vertexid) {
        AjaxService.load('/add-contact-to-conversation', 'post', {
            contact: identifier,
            chat: vertexid,
        })
    },
    sendMessage(message, chat_id, attachedFiles = []) {

        const formData = new FormData()
        formData.append('message', message)
        formData.append('chat_id', chat_id)
        attachedFiles.forEach((file, i) => {
            formData.append(`files[${i}]`, file.data)
        })

        AjaxService.load(
            '/send-chat-message', 
            'post', 
            formData,
            {
                err: null, msg: null, options: null
            },
            {
                'X-Socket-ID': Echo.socketId()
            }
        )
    },
    async editMessage(vertexid) {
        const source = await AjaxService.load(`/edit-chat-message/${vertexid}`)
        return source
    },
    receiveMessage(payload) {
        this.messages.push(payload)
    },
    sendAudio(formData) {
        AjaxService.load(
        '/send-chat-audio', 
        'post', 
        formData,
        {
            err: null, msg: null, options: null
        },
        {
            'X-Socket-ID': Echo.socketId()
        })
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
                chat_id: payload.chatId,
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