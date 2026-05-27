/**
 * payloadSize.js — Mesure et contrôle de taille des payloads WebRTC2
 *
 * Source de vérité unique pour le dimensionnement des payloads échangés sur les
 * data channels (émission mesh, retransmission hub star, réception). Centralise
 * le contrôle anti-DoS afin que les chemins d'envoi ET de réception appliquent
 * exactement la même règle (MAX_PAYLOAD_BYTES, JSON + binaire).
 */
import { MAX_PAYLOAD_BYTES } from '../../webrtc2.config.js'

/**
 * Calcule la taille en octets d'un payload, qu'il soit binaire natif ou JSON.
 *
 * @param {*} payload  Données à mesurer (Blob, ArrayBuffer, TypedArray, string, JSON)
 * @returns {{ ok: true, bytes: number, kind: string } | { ok: false, reason: string }}
 */
export function getPayloadSizeBytes(payload) {
    // Autorise les payloads binaires natifs navigateur
    if (payload instanceof Blob) {
        return { ok: true, bytes: payload.size, kind: 'blob' }
    }

    if (payload instanceof ArrayBuffer) {
        return { ok: true, bytes: payload.byteLength, kind: 'arraybuffer' }
    }

    if (ArrayBuffer.isView(payload)) {
        return { ok: true, bytes: payload.byteLength, kind: 'typed-array' }
    }

    // String brute
    if (typeof payload === 'string') {
        return { ok: true, bytes: new TextEncoder().encode(payload).length, kind: 'string' }
    }

    // JSON (objets, tableaux, nombres, booleens, null)
    const valueType = typeof payload
    const isJsonCompatible = payload === null || valueType === 'object' || valueType === 'number' || valueType === 'boolean'
    if (isJsonCompatible) {
        try {
            const json = JSON.stringify(payload)
            if (typeof json !== 'string') {
                return { ok: false, reason: 'payload JSON invalide apres serialisation' }
            }
            return { ok: true, bytes: new TextEncoder().encode(json).length, kind: 'json' }
        } catch (error) {
            return { ok: false, reason: 'payload JSON non serialisable' }
        }
    }

    return { ok: false, reason: `type non supporte (${valueType})` }
}

/**
 * Contrôle anti-DoS d'un payload : vérifie qu'il est mesurable ET qu'il ne dépasse
 * pas MAX_PAYLOAD_BYTES. Retourne true si le traitement peut se poursuivre, false
 * s'il doit être abandonné (payload invalide ou trop volumineux). Logge un warning
 * descriptif dans les deux cas de rejet.
 *
 * @param {*} data        Payload à contrôler
 * @param {string} logPrefix  Préfixe de log (ex: '[Mesh]', '[Recv]')
 * @returns {boolean}
 */
export function isPayloadWithinLimit(data, logPrefix) {
    const payloadSize = getPayloadSizeBytes(data)
    if (!payloadSize.ok) {
        console.warn(`${logPrefix} Payload ignoré: invalide`, { reason: payloadSize.reason })
        return false
    }
    if (payloadSize.bytes > MAX_PAYLOAD_BYTES) {
        console.warn(
            `${logPrefix} Payload ignoré: trop volumineux ` +
            `(${payloadSize.bytes} octets > ${MAX_PAYLOAD_BYTES})`,
            { payloadKind: payloadSize.kind }
        )
        return false
    }
    return true
}
