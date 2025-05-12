import { useAjaxService } from '~estarter/services/AjaxService.js'
import eventBus from '~estarter/services/eventBus.js'
const AjaxService = useAjaxService()

export default {
    async loadOwner(slug) {
        this.owner = await AjaxService.load(`/wall/${slug}`)
    },
    async updateAvatar(formData) {
        const response = await AjaxService.load('/update-avatar', 'post', formData)
        eventBus.$emit('refresh-global-user')
        return response
    },
    async updateCover(formData) {
        const response = await AjaxService.load('/update-cover', 'post', formData)
        eventBus.$emit('refresh-global-user')
        return response
    },
    resetWall() {
        this.$reset()
    },
    
}