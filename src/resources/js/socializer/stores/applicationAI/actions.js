import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

export default {
    async databaseAction(payload) {
       const resp = await AjaxService.load('/app-ia-database-action', 'post', payload)
       return resp.original
    },
    async loadApplication(payload) {
        return await AjaxService.load('/load-ia-application', 'post', payload)
    },
    async saveApplication(payload) {
        return await AjaxService.load('/save-ia-application', 'post', payload)
    }
}