import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

async function checkServerAccess(serverId) {
    try {
        let result = await AjaxService.load(`/check-server-access/${serverId}`)
        return result
    } catch(err) {
        return false
    }
}

export {
    checkServerAccess,
}