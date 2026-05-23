import EventBus from '~estarter/services/eventBus'

export default (conn, context) => {

    console.log('nouvelle connexion data screen')

    conn.on("open", () => {
        console.log('connection data screen ouverte')
    })
    conn.on("close", () => {
        console.log('connection data screen fermée')
    })
    conn.on("data", (data) => {
        EventBus.$emit('videoPlayerEvent', data)
    })
}
