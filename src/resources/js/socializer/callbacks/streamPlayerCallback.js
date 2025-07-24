export default (call, context) => {
    const receivedStreams = new Set()

    // ici ne renvoi rien car sens unique
    call.answer()

    call.on('stream', async(stream) => {
        if (receivedStreams.has(stream.id)) {
            return
        }

        receivedStreams.add(stream.id)

        if (stream instanceof MediaStream) {

            await context.createVideoElement(
                {
                    videoId: call.connectionId, 
                    nickname: call.metadata.from,
                    peer: call,
                    source: call.metadata.source,
                    roomId: call.metadata.room,
                },
                stream
            )

            if(stream.getVideoTracks().length > 0) {
                stream.getVideoTracks()[0].addEventListener('ended', () => {
                    context.$emit('stoped-stream', call.metadata.source, call.connectionId)
                })
            } else if( stream.getAudioTracks().length > 0) {
                 stream.getAudioTracks()[0].addEventListener('ended', () => {
                    context.$emit('stoped-stream', call.metadata.source, call.connectionId)
                })
            }

            context.$emit('started-stream', call.metadata.source, call.connectionId, true)

        } else {

            console.error("Le flux n'est pas valide ou n'a pas été reçu correctement.")
        }
    })

    call.on('close', () => {
        context.removeVideoElement(call.connectionId)
        context.deleteRemoteOpenedConnections(call)
       

    })

    call.on('error', (err) => {
        console.error('Erreur sur la connexion entrante :', err);
    });
}
