export default async (call, context) => {
    console.log('nouvelle connexion Visio', call)

    const receivedStreams = new Set()

    context.startVisioStream({
        audio: false,
        video: true,
    }, true).then(() => {

        call.answer(context.currentStream)

        context.storeConnection(call, {
            options: { 
                metadata: { 
                    slug: call.metadata.from,
                    from: call.metadata.slug,
                    source: call.metadata.source,
                    room: call.metadata.room,
                }, 
            },
            room: call.metadata.room,
            type: call.metadata.source,
        })

        context.setCurrentCallRoomId(call.metadata.room)

        if(!document.getElementById('local-visio')) {
            console.log('Creating local video element for visio', context.currentStream)
             context.createVideoElement(
                {
                    videoId: 'local-visio',
                    nickname: context.me.slug
                },
                context.currentStream
            )
        }

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
                       // peer: call,  commented coz two-way diffusion
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

                context.setCallInProgress(true)

                context.$emit('started-stream', call.metadata.source, call.connectionId, true)
            
            } else {

                console.error("Le flux n'est pas valide ou n'a pas été reçu correctement.")
           
            }
        })

        call.on('close', () => {
            console.log("Connexion visio fermée")
            context.removeVideoElement(call.connectionId)
            context.stopUserVisioStream(call.metadata.from, 'visio')
            context.deleteRemoteOpenedConnections(call)
        })

        call.on('error', (err) => console.error('Erreur d’appel :', err))

    })
    .catch(function (err) {
      window.AWN.alert(`${err.name} : votre webcam n'est pas accessible`)
      context.onResponseCallError(call, err)
    })
}
