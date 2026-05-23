export default (call, context) => {
    const receivedStreams = new Set()

    call.answer()
    
    call.on('stream', async(stream) => {

        if (receivedStreams.has(stream.id)) {
            return
        }

        receivedStreams.add(stream.id)

        if (stream instanceof MediaStream) {

            if(typeof context.saveRemoteStream === 'function') {

                console.log('Enregistrement du flux distant:', call.metadata.from, stream, call.metadata.source)
                context.saveRemoteStream(call.metadata.room, call.metadata.from, stream, call.metadata.source)

            } else {
                console.warn('saveRemoteStream indisponible sur le contexte du callback entrant')
            }

            if (typeof context.createVideoElement === 'function') {
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
            }

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

        if (typeof context.removeVideoElement === 'function') {
            context.removeVideoElement(call.connectionId)
        }

        if (typeof context.deleteRemoteOpenedConnections === 'function') {
            context.deleteRemoteOpenedConnections(call.connectionId)
        }

        if(typeof context.removeRemoteStream === 'function') {
            context.removeRemoteStream(call.metadata.room, call.metadata.from, call.metadata.source)
        } else {
            console.warn('removeRemoteStream indisponible sur le contexte du callback entrant')
        }

    })

    call.on('error', (err) => {
        console.error('Erreur sur la connexion entrante :', err);
    });
}
