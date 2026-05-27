/**
 * payloadSize.test.js
 *
 * Tests unitaires de la mesure de taille et du contrôle anti-DoS des payloads
 * WebRTC2 (getPayloadSizeBytes / isPayloadWithinLimit). Cette logique est la
 * source de vérité partagée par l'émission mesh, la retransmission hub star et
 * le garde en réception (handleData) — couvre la faille [MOYENNE] DoS pair-à-pair.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getPayloadSizeBytes, isPayloadWithinLimit } from '~socializer/components/WebRTC2/Composables/utils/payloadSize.js'
import { MAX_PAYLOAD_BYTES } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('getPayloadSizeBytes', () => {
    it('mesure une string (UTF-8)', () => {
        expect(getPayloadSizeBytes('hello')).toEqual({ ok: true, bytes: 5, kind: 'string' })
        // Un caractère multi-octets compte ses octets UTF-8 réels
        expect(getPayloadSizeBytes('é')).toEqual({ ok: true, bytes: 2, kind: 'string' })
    })

    it('mesure un ArrayBuffer', () => {
        const buf = new ArrayBuffer(128)
        expect(getPayloadSizeBytes(buf)).toEqual({ ok: true, bytes: 128, kind: 'arraybuffer' })
    })

    it('mesure une TypedArray', () => {
        const view = new Uint8Array(64)
        expect(getPayloadSizeBytes(view)).toEqual({ ok: true, bytes: 64, kind: 'typed-array' })
    })

    it('mesure un Blob', () => {
        const blob = new Blob(['abcdef'])
        const res = getPayloadSizeBytes(blob)
        expect(res.ok).toBe(true)
        expect(res.kind).toBe('blob')
        expect(res.bytes).toBe(6)
    })

    it('mesure un objet JSON sur sa sérialisation', () => {
        const obj = { a: 1, b: 'xy' }
        const expectedBytes = new TextEncoder().encode(JSON.stringify(obj)).length
        expect(getPayloadSizeBytes(obj)).toEqual({ ok: true, bytes: expectedBytes, kind: 'json' })
    })

    it('rejette un type non sérialisable (fonction)', () => {
        const res = getPayloadSizeBytes(() => {})
        expect(res.ok).toBe(false)
        expect(res.reason).toMatch(/type non supporte/)
    })

    it('rejette un objet à référence circulaire', () => {
        const a = {}
        a.self = a
        const res = getPayloadSizeBytes(a)
        expect(res.ok).toBe(false)
        expect(res.reason).toMatch(/non serialisable/)
    })
})

describe('isPayloadWithinLimit', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('accepte un payload sous la limite', () => {
        expect(isPayloadWithinLimit('ok', '[Recv]')).toBe(true)
    })

    it('accepte un payload pile à la limite (binaire)', () => {
        expect(isPayloadWithinLimit(new ArrayBuffer(MAX_PAYLOAD_BYTES), '[Recv]')).toBe(true)
    })

    it('rejette un payload dépassant la limite (1 octet de trop)', () => {
        expect(isPayloadWithinLimit(new ArrayBuffer(MAX_PAYLOAD_BYTES + 1), '[Recv]')).toBe(false)
        expect(console.warn).toHaveBeenCalled()
    })

    it('rejette une string trop volumineuse', () => {
        const huge = 'x'.repeat(MAX_PAYLOAD_BYTES + 1)
        expect(isPayloadWithinLimit(huge, '[Recv]')).toBe(false)
    })

    it('rejette un payload non mesurable', () => {
        expect(isPayloadWithinLimit(() => {}, '[Recv]')).toBe(false)
        expect(console.warn).toHaveBeenCalled()
    })
})
