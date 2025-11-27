export default {
    getOwner() {
        return this.owner
    },
    getOwnedServers() {
        if(!this.owner.servers) {
            return []
        }
        return this.owner.servers
    }
}