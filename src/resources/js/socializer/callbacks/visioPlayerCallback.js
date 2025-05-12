import EventBus from '~estarter/services/eventBus'

export default async (call, context) => {
    console.log('nouvelle connexion Visio')

    context.startVisioStream({
        audio: false,
        video: true,
    }).then(() => {

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
             context.createVideoElement(
                {
                    videoId: 'local-visio',
                    nickname: context.me.slug
                },
                context.currentStream
            )
        }

        call.on('stream', async(stream) => {

            if (stream instanceof MediaStream) {
                 context.createVideoElement(
                    {
                        videoId: call.connectionId, 
                        nickname: call.metadata.from,
                       // peer: call,  commented coz two-way diffusion
                    },
                    stream
                )

                stream.getVideoTracks()[0].addEventListener('ended', () => {
                    context.$emit('stoped-stream', call.metadata.source, call.connectionId)
                })

                context.setCallInProgress(true)
                context.$emit('started-stream', call.metadata.source, call.connectionId, true)
            
            } else {

                console.error("Le flux n'est pas valide ou n'a pas été reçu correctement.")
           
            }
        })

        call.on('close', () => {
            console.log("Connexion visio fermée")
            context.stopUserVisioStream(call.metadata.from, 'visio')
        })

        call.on('error', (err) => console.error('Erreur d’appel :', err))

    })
    .catch(function (err) {
      window.AWN.alert(`${err.name} : votre webcam n'est pas accessible`)
      context.onResponseCallError(call, err)
    })
}
