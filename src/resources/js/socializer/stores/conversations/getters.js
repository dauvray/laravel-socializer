export default {
    getConversations() {
        let conversations = []
        for (const [key, value] of Object.entries(this.conversations)) {
            conversations.push(this.conversations[key])
          }

          return conversations
    },
}