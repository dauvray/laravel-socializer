import { useAjaxService } from '~estarter/services/AjaxService.js'
import { helpers } from '~formdesigner/application/formCreator/utils/formItemSettings.js'
import { orderBy, sortUpElement, sortDownElement } from '~estarter/services/helpers.js'
const AjaxService = useAjaxService()
import { useQuestionnaireStore } from '~formdesigner/stores/questionnaire.js'

export default {
    /*-----------------------------------
    | SERVER
    |-----------------------------------*/

    async createServer(payload) {
         let result = await AjaxService.load('/create-server', 'post', {server: payload})
         return result
    },
    async loadAllServers() {
        let result = await AjaxService.load('/get-all-servers')
        this.servers = result
    },
    async loadServer(serverId) {
        try{
            let result = await AjaxService.load(`/load-server/${serverId}`)
            this.currentServer = result
            this.currentServer.rooms.sort( orderBy( ['position'], ['asc'] ) )
            return this.currentServer
          } catch(err) {
            return false
          }
    },
    resetServer() {
        this.currentServer = null
    },
    async deleteServer(serverId) {
        let result = await AjaxService.load(`/delete-server/${serverId}`)
        return result
    },
    async updateServer(payload, isEvent = false) {

        if(!isEvent) {
            await AjaxService.load(`/update-server`, 'post', payload)

        } else {
            const cleanModel = helpers.cleanModel({...payload})
            this.currentServer.server = {...cleanModel}
        }
    },
    async updateServerRooms() {
        await AjaxService.load(`/update-server-rooms`, 'post', {
            serverId: this.currentServer.server.id,
            rooms: this.currentServer.rooms
        })
    },
    async loadRegisteredServers() {
        this.registeredServers = await AjaxService.load(`/get-registered-servers`)
    },

    /*-----------------------------------
    | ROOM
    |-----------------------------------*/

    async createRoom(payload) {
        const cleanModel = helpers.cleanModel({...payload})
        await AjaxService.load('/create-server-room', 'post', cleanModel)
    },
    async createSubContent(payload, isEvent = false) {
        if(!isEvent) {
            const result = await AjaxService.load('/create-sub-content', 'post', payload)
        } else {
            this.currentRoom.content.push(payload)
        }
    },
    addNewRoom(payload) {  // from event broadcast
        this.currentServer.rooms.push(payload)
    },
    async loadRoom(roomId) {
        try{
            let result = await AjaxService.load(`/load-room/${roomId}`)
            this.currentRoom = result
            this.currentRoom.content.sort( orderBy( ['position'], ['asc'] ) )
            // is locked ?
            // if(result.hasOwnProperty('content')) {
            //     this.currentContent = result.content[0]
            // }
            // // sub content ?
            // if(result.subcontent) {
            //     this.currentContent['subContent'] = result.subcontent
            // }
            return result
        } catch(err) {
            return false
        }
    },
    async updateRoom(payload, isEvent = false) {
        
        if(!isEvent) {
            await AjaxService.load(`/update-server-room`, 'post', payload)
        }

        const cleanModel = helpers.cleanModel({...payload})

        this.currentServer.rooms.forEach((room, idx) => {
            if(room.id === payload.id) {
                this.currentServer.rooms[idx] = {...this.currentServer.rooms[idx], ...cleanModel}
            }
        })

        if(this.currentRoom && this.currentRoom.id === payload.id) {
            this.currentRoom = {...this.currentRoom, ...cleanModel}
        }

    },
    setCurrentContent(payload) {
        this.currentRoom.content[0] = payload
    },
    resetCurrentRoom() {
        this.currentRoom = null
    },
    async deleteRoom(roomId, isEvent = false) {
        let result = null 

        if(!isEvent) {
            result = await AjaxService.load(`/delete-server-room/${roomId}`)
        }
       
        this.currentServer.rooms = this.currentServer.rooms.filter( room => {
            return room.id !== roomId
        })

        return result
    },
    sortUpRoom(index) {
        this.currentServer.rooms = sortUpElement(index, this.currentServer.rooms).map((room,idx) => {
            room.position = idx+1
            return room
        })
        this.updateServerRooms()
    },
    sortDownRoom(index) {
        this.currentServer.rooms = sortDownElement(index, this.currentServer.rooms).map((room,idx) => {
            room.position = idx+1
            return room
        })
        this.updateServerRooms()
    },
    async addRoomModule(payload) {
        const result = await AjaxService.load(`/add-room_module`, 'post', {
            type: payload.get('model'),
            server_id: this.currentServer.server.id,
        })
    },  

    /*-----------------------------------
    | QUESTIONNAIRES
    |-----------------------------------*/

    async loadServerQuestionnaires(per_page = null) {

        let url = "/load-server-questionnaire-list"

        if(per_page) {
            url = `${url}?per_page=${per_page}`
        }

        const result = await AjaxService.load(url, 'post', {
            server_id : this.getCurrentServer.id
        })

        return result
    },
    async saveServerQuestionnaire(payload) {
        const result = await AjaxService.load('/save-server-questionnaire', 'post', {
            settings: payload.settings,
            title: payload.title,
            server_id: this.getCurrentServer.id
        })

        return result
    },
    async deleteServerQuestionnaire(questionnaireId) {
        const deletedID = await AjaxService.load('/delete-server-questionnaire', 'post', {
            questionnaire_id: questionnaireId,
        })

        return deletedID;
    },
    async sendAnswerQuestionnaire(formData) {
        const questionnaire = useQuestionnaireStore()
        const result = await questionnaire.sendAnswersQuestionnaire(formData, '/send-social-answers')
        return result
    },

    /*-----------------------------------
    | WhiteBoard
    |-----------------------------------*/

    async loadWhiteBoard(payload) {
        const result = await AjaxService.load('/load-white-board', 'post', payload)
        return result
    },
    async saveWhiteBoard(payload) {
        const result = await AjaxService.load('/save-white-board', 'post', payload)
        return result
    },

    /*-----------------------------------
    | PAGES
    |-----------------------------------*/

    async submitPagePrompt(payload) {
      
        const result = await AjaxService.load('/generate-room-page', 'post', {
            prompt: payload.prompt,
            page_id: payload.pageId,
            bot_id: payload.botId,
            server_id: this.getCurrentServer.id
        })
        
    }

}