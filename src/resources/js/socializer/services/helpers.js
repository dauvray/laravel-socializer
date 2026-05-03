import { useAjaxService } from '~estarter/services/AjaxService.js'
const AjaxService = useAjaxService()

const checkServerAccess = async (serverId) => {
    try {
        let result = await AjaxService.load(`/check-server-access/${serverId}`)
        return result
    } catch(err) {
        return false
    }
}

const normalizePeerMetadata = (metadata = {}) => {
    const normalizedMetadata = {
        slug: metadata?.slug != null ? String(metadata.slug) : '',
        from: metadata?.from != null ? String(metadata.from) : '',
        source: metadata?.source != null ? String(metadata.source) : '',
        room: metadata?.room != null ? String(metadata.room) : '',
    }

    if (metadata?.callback != null) {
        normalizedMetadata.callback = String(metadata.callback)
    }

    if (metadata?.callbackKey != null) {
        normalizedMetadata.callbackKey = String(metadata.callbackKey)
    }

    return normalizedMetadata
}

export {
    checkServerAccess,
    normalizePeerMetadata,
}