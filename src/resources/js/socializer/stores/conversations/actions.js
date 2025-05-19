import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

export default {
    async loadConversations() {
        let result = await AjaxService.load('/load-my-conversations')
        this.conversations = result

    },
}