
import { useMeStore } from '~estarter/stores/me.js'
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
    isOwner() {
        if(this.currentServer) {
            const useMe = useMeStore()
            return this.currentServer.owner.id === useMe.user.vertexid
        }
        return false
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
        if(this.currentContent) {
            return streamableComponents.includes(this.currentContent.content_type)
        }
        return false
    },
    getCurrentContent() {
        if(this.currentContent) {
            return this.currentContent
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