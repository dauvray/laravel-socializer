export default {
    questionnaires: {
        /*-------------------------------------
        | SERVERS
        |--------------------------------------*/
        postMessage: import.meta.env.VITE_SOCIALIZER_POST_FORM_ID,
        createServer: import.meta.env.VITE_SOCIALIZER_CREATE_SERVER_FORM_ID,
        createServerRoom: import.meta.env.VITE_SOCIALIZER_CREATE_ROOM_FORM_ID,
        createRoomModule:  import.meta.env.VITE_SOCIALIZER_ADD_ROOM_MODULE_ID,
        appAiDetails: import.meta.env.VITE_SOCIALIZER_APP_AI_DETAILS_ID,
    },
}