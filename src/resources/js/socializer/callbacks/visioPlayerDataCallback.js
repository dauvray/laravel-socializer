import EventBus from '~estarter/services/eventBus'

export default (conn, context) => {

    console.log('nouvelle connexion data Video', conn)

    // added coz two-way diffusion
    context.storeConnection(conn, {
        options: { 
            metadata: { 
                slug: conn.metadata.from,
                from: conn.metadata.slug,
                source: conn.metadata.source,
                room: conn.metadata.room,
            }, 
        },
        room: conn.metadata.room,
        type: conn.metadata.source,
    })

    conn.on("open", () => {
        console.log('connection data player ouverte')
    })
    conn.on("close", () => {
        console.log('connection data player fermée')
    })
    conn.on("data", (data) => {
        EventBus.$emit('videoPlayerEvent', data)

    })
}
