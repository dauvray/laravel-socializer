import EventBus from '~estarter/services/eventBus'

export default (call, context) => {
    console.log('nouvelle connexion stream')

    // ici ne renvoi rien car sens unique
    call.answer()

    call.on('stream', async(stream) => {
        if (stream instanceof MediaStream) {
            await context.createVideoElement(
                {
                    videoId: call.connectionId, 
                    nickname: call.metadata.from,
                    peer: call,
                },
                stream
            )

            stream.getVideoTracks()[0].addEventListener('ended', () => {
                context.$emit('stoped-stream', call.metadata.source, call.connectionId)
            })

            context.$emit('started-stream', call.metadata.source, call.connectionId, true)
        } else {
            console.error("Le flux n'est pas valide ou n'a pas été reçu correctement.")
        }
    })

    call.on('close', () => {
        console.log("Connexion stream fermée")
        context.removeVideoElement(call.connectionId)
    })
}
