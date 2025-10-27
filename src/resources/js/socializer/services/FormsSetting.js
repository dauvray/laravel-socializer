export default {
    questionnaires: {
        /*-------------------------------------
        | POSTS
        |--------------------------------------*/
        postMessage: import.meta.env.VITE_SOCIALIZER_POST_FORM_ID,
        /*-------------------------------------
        | SERVERS
        |--------------------------------------*/
        createServer: import.meta.env.VITE_SOCIALIZER_CREATE_SERVER_FORM_ID,
        accessPrivateServer: import.meta.env.VITE_SOCIALIZER_ACCESS_PRIVATE_SERVER_FORM_ID,
        /*-------------------------------------
        | ROOMS
        |--------------------------------------*/
        createServerRoom: import.meta.env.VITE_SOCIALIZER_CREATE_ROOM_FORM_ID,
        createRoomModule:  import.meta.env.VITE_SOCIALIZER_ADD_ROOM_MODULE_ID,
        appAiDetails: import.meta.env.VITE_SOCIALIZER_APP_AI_DETAILS_ID,
    },
}