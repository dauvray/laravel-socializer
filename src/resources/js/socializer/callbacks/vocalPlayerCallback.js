import EventBus from '~estarter/services/eventBus'

export default async (call, context) => {
    console.log('nouvelle connexion Call')
    console.log('Appel entrant reçu');

    context.startWebcamStream({
        audio: false,
        video: true,
    }).then(() => {

        console.log(context)
        console.log('Répond à l’appel avec le flux local', context.currentStream)
        call.answer(context.currentStream)

        if(!document.getElementById('local-webcam')) {
             context.createVideoElement(
                {
                    videoId: 'local-webcam',
                    nickname: context.me.slug
                },
                context.currentStream
            )
        }

        call.on('stream', async(stream) => {
            console.log('Flux distant reçu :', stream);
            console.log('Tracks vidéo :', stream.getVideoTracks());
            console.log('Tracks audio :', stream.getAudioTracks());
            if (stream instanceof MediaStream) {
                 context.createVideoElement(
                    {
                        videoId: call.connectionId, 
                        nickname: call.metadata.from,
                        peer: call,
                    },
                    stream
                )

                stream.getVideoTracks()[0].addEventListener('ended', () => {
                    console.log('ended stream entrant')
                    context.$emit('stoped-stream', call.metadata.source, call.connectionId)
                })

                context.$emit('started-stream', call.metadata.source, call.connectionId, true)
            
            } else {

                console.error("Le flux n'est pas valide ou n'a pas été reçu correctement.")
           
            }
        })

        call.on('close', () => {
            console.log("Connexion call fermée")
            context.removeVideoElement(call.connectionId)
        })

        call.on('error', (err) => console.error('Erreur d’appel :', err))

    })
    .catch(function (err) {
    // console.log(err.name + ": " + err.message)
      window.AWN.alert(`${err.name} : votre webcam n'est pas accessible`)
      context.onResponseCallError(call, err)
    })
}
