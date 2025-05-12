import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

export default {
    async loadApplications() {
        this.applications = await AjaxService.load('/get-store-applications', 'post', {})
    },
}