import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

export default {

    async submitLike(payload, storeId, type) {
        const like = await AjaxService.load(
            '/send-like', 
            'post', 
            {
                isLiked: payload.value,
                vertexid: payload.itemVid,
                storeid: storeId,
                type: type,
            },
            {
                err: null, 
                msg: null, 
                options: null
            },
            {
                'X-Socket-ID': Echo.socketId()
            }
        )
        return like
    },

}