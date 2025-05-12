import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

export default {
    async loadUsers() {
        this.users = await AjaxService.load('/get-user-list', 'post', {})
    },
    async sendSearchAlert(questionnaire_id, filters, hash) {
        await AjaxService.load('/feed-subscribe-alert', 'post', {questionnaire_id , filters, hash})
    },
}