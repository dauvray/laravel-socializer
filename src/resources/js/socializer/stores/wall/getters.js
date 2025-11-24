export default {
    getOwner() {
        return this.owner
    },
    getOwnedServers() {
        return this.owner.servers
    }
}