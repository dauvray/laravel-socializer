export const WEBRTC2_EVENTS = Object.freeze({
    CALL_USER: 'call-user',
    CLOSE_CALL: 'close-call',
})

const DEFAULTS = Object.freeze({
    type: 'visio',
    source: 'webrtc2',
    reason: 'unknown',
})

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0

const normalizeType = (value) => {
    if (!isNonEmptyString(value)) return DEFAULTS.type
    const t = value.trim().toLowerCase()
    return (t === 'visio' || t === 'vocal') ? t : DEFAULTS.type
}

const normalizeSource = (value) => {
    if (!isNonEmptyString(value)) return DEFAULTS.source
    return value.trim()
}

const normalizeReason = (value) => {
    if (!isNonEmptyString(value)) return DEFAULTS.reason
    return value.trim()
}

const now = () => Date.now()

function assertEventBus(eventBus) {
    return !!eventBus && typeof eventBus.$emit === 'function' && typeof eventBus.$on === 'function' && typeof eventBus.$off === 'function'
}

/**
 * Payload canonique call-user (interne)
 * {
 *   toUserSlug: string,
 *   type: 'visio' | 'vocal',
 *   roomId: string|null,
 *   source: string,
 *   at: number
 * }
 */
export function normalizeCallUserPayload(payload = {}) {
    const toUserSlug = payload?.toUserSlug ?? payload?.userSlug ?? payload?.slug ?? null
    if (!isNonEmptyString(toUserSlug)) return null

    return {
        toUserSlug: toUserSlug.trim(),
        type: normalizeType(payload?.type),
        roomId: isNonEmptyString(payload?.roomId) ? payload.roomId.trim() : null,
        source: normalizeSource(payload?.source),
        at: Number.isFinite(payload?.at) ? payload.at : now(),
    }
}

/**
 * Entrée canonique close-call
 * {
 *   userSlug: string,
 *   type: 'visio' | 'vocal',
 *   roomId: string|null,
 *   reason: string,
 *   source: string,
 *   at: number
 * }
 */
export function normalizeCloseCallEntry(entry = {}, fallback = {}) {
    const userSlug = entry?.userSlug ?? entry?.toUserSlug ?? entry?.slug ?? fallback?.userSlug ?? null
    if (!isNonEmptyString(userSlug)) return null

    return {
        userSlug: userSlug.trim(),
        type: normalizeType(entry?.type ?? fallback?.type),
        roomId: isNonEmptyString(entry?.roomId)
            ? entry.roomId.trim()
            : (isNonEmptyString(fallback?.roomId) ? fallback.roomId.trim() : null),
        reason: normalizeReason(entry?.reason ?? fallback?.reason),
        source: normalizeSource(entry?.source ?? fallback?.source),
        at: Number.isFinite(entry?.at) ? entry.at : (Number.isFinite(fallback?.at) ? fallback.at : now()),
    }
}

/**
 * Accepte:
 * - ancien format: [{ userSlug, type }]
 * - objet unique
 * - null/undefined
 * Retourne toujours: Array<CloseCallEntry canonique>
 */
export function normalizeCloseCallPayload(payload, fallback = {}) {
    const base = {
        type: fallback?.type ?? DEFAULTS.type,
        roomId: fallback?.roomId ?? null,
        reason: fallback?.reason ?? DEFAULTS.reason,
        source: fallback?.source ?? DEFAULTS.source,
        at: fallback?.at ?? now(),
        userSlug: fallback?.userSlug ?? null,
    }

    const list = Array.isArray(payload) ? payload : [payload]
    return list
        .map((entry) => normalizeCloseCallEntry(entry || {}, base))
        .filter(Boolean)
}

/**
 * Émet call-user en conservant la compat descendante:
 * eventBus.$emit('call-user', toUserSlug, type)
 * + meta optionnelle en 3e argument
 */
export function emitCallUser(eventBus, payload = {}) {
    if (!assertEventBus(eventBus)) return null

    const normalized = normalizeCallUserPayload(payload)
    if (!normalized) return null

    eventBus.$emit(
        WEBRTC2_EVENTS.CALL_USER,
        normalized.toUserSlug,
        normalized.type,
        {
            roomId: normalized.roomId,
            source: normalized.source,
            at: normalized.at,
        }
    )

    return normalized
}

/**
 * Émet close-call avec payload canonique:
 * eventBus.$emit('close-call', Array<CloseCallEntry>)
 */
export function emitCloseCall(eventBus, payload, fallback = {}) {
    if (!assertEventBus(eventBus)) return []

    const normalized = normalizeCloseCallPayload(payload, fallback)
    if (normalized.length === 0) return []

    eventBus.$emit(WEBRTC2_EVENTS.CLOSE_CALL, normalized)
    return normalized
}

export function onCallUser(eventBus, callback) {
    if (!assertEventBus(eventBus) || typeof callback !== 'function') return () => {}

    const handler = (toUserSlug, type, meta = {}) => {
        const normalized = normalizeCallUserPayload({
            toUserSlug,
            type,
            roomId: meta?.roomId ?? null,
            source: meta?.source ?? DEFAULTS.source,
            at: meta?.at,
        })
        if (normalized) callback(normalized)
    }

    eventBus.$on(WEBRTC2_EVENTS.CALL_USER, handler)
    return () => eventBus.$off(WEBRTC2_EVENTS.CALL_USER, handler)
}

export function onCloseCall(eventBus, callback, fallback = {}) {
    if (!assertEventBus(eventBus) || typeof callback !== 'function') return () => {}

    const handler = (payload) => {
        const normalized = normalizeCloseCallPayload(payload, fallback)
        callback(normalized)
    }

    eventBus.$on(WEBRTC2_EVENTS.CLOSE_CALL, handler)
    return () => eventBus.$off(WEBRTC2_EVENTS.CLOSE_CALL, handler)
}

export function offCallUser(eventBus, handler) {
    if (!assertEventBus(eventBus) || typeof handler !== 'function') return
    eventBus.$off(WEBRTC2_EVENTS.CALL_USER, handler)
}

export function offCloseCall(eventBus, handler) {
    if (!assertEventBus(eventBus) || typeof handler !== 'function') return
    eventBus.$off(WEBRTC2_EVENTS.CLOSE_CALL, handler)
}