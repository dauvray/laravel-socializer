import EventBus from '~estarter/services/eventBus'

export default (conn, context) => {

    console.log('nouvelle connexion data Visio', conn)

    // added coz two-way diffusion
    context.storeConnection(conn, {
        options: { 
            metadata: { 
                slug: conn.metadata.from,
                from: conn.metadata.slug,
                source: conn.metadata.source,
                room: conn.metadata.room,
                callback: conn.metadata.callback
            }, 
        },
        room: conn.metadata.room,
        type: conn.metadata.source,
    })

    conn.on("open", () => {
        console.log('connection data visio ouverte')
    })
    conn.on("close", () => {
        console.log('connection data visio fermée')
    })
    conn.on("data", (data) => {
        console.log('data visio reçue', data)
        EventBus.$emit('videoPlayerEvent', data)

    })
}
