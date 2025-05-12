import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

export default {
    async followUser(userIdentifier) {
      let res = await AjaxService.load('/follow-user', 'post', {
            identifier: userIdentifier,
        })
        return res['status']
    },
    async unfollowUser(userIdentifier) {
        let res = await AjaxService.load('/unfollow-user', 'post', {
            identifier: userIdentifier,
        })
        return res['status']
    },
}