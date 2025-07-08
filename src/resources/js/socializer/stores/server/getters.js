import { streamableComponents } from '~socializer/components/Server/roomSettings.js'

export default {
    getServers() {
        return this.servers.data
    },
    getCurrentServer() {
        if(this.currentServer) {
            return this.currentServer.server
        }
        return null
    },
    getCurrentServeId() {
        if(this.currentServer) {
            return this.currentServer.server.id
        }
        return null
    },
    getRegisteredServers() {
        return this.registeredServers
    },
    getServerPage() {
        if(this.currentServer) {
            return this.currentServer.page
        }
        return null
    },
    getServerRooms() {
        if(this.currentServer) {
            return this.currentServer.rooms
        }
        return null
    },
    getOwnerId() {
        if(this.currentServer) {
            return this.currentServer.owner.id
        }
        return null
    },
    getCurrentRoom() {
        if(this.currentRoom) {
            return this.currentRoom
        }
        return null
    },
    getCurrentRoomContent() {
        if(this.currentRoom && this.currentRoom.hasOwnProperty('content')) {
            // the first is main content so we skip it
            return this.currentRoom.content.slice(1)
        }
        return null
    },
    getIsRoomStreamable() {
        if(this.currentRoom) {
            return streamableComponents.includes(this.currentRoom.content[0].content_type)
        }
        return false
    },
    getCurrentContent() {
        if(this.currentRoom) {
            return this.currentRoom.content[0]
        }
        return null
    },
    getCurrentRoomId() {
        if(this.currentRoom) {
            return this.currentRoom.id
        }
        return null
    },
}