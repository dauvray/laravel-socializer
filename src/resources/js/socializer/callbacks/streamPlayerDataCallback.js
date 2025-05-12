import EventBus from '~estarter/services/eventBus'

export default (conn, context) => {

    console.log('nouvelle connexion data stream')

    conn.on("open", () => {
        console.log('connection data stream ouverte')
    })
    conn.on("close", () => {
        console.log('connection data stream fermée')
    })
    conn.on("data", (data) => {
        EventBus.$emit('videoPlayerEvent', data)
    })
}
