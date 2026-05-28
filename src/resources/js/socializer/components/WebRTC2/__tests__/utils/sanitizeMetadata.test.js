/**
 * sanitizeMetadata.test.js
 *
 * Tests unitaires de la sanitization des métadonnées PeerJS entrantes
 * (sanitizeMetadataType). Couvre la faille [FAIBLE] de l'audit du 2026-05-20 :
 * `conn.metadata.type` est contrôlé par le pair distant et était jusque-là
 * consommé directement comme clé de store et dans les logs.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeMetadataType } from '~socializer/components/WebRTC2/Composables/utils/sanitizeMetadata.js'
import { VALID_CONNECTION_TYPES } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('sanitizeMetadataType', () => {
    it('accepte chaque type listé dans VALID_CONNECTION_TYPES', () => {
        for (const validType of VALID_CONNECTION_TYPES) {
            expect(sanitizeMetadataType(validType)).toBe(validType)
        }
    })

    it('rejette une chaîne arbitraire hors whitelist', () => {
        expect(sanitizeMetadataType('forged')).toBeNull()
        expect(sanitizeMetadataType('admin')).toBeNull()
        expect(sanitizeMetadataType('')).toBeNull()
    })

    it('rejette les variations de casse (la whitelist est sensible à la casse)', () => {
        expect(sanitizeMetadataType('DATA')).toBeNull()
        expect(sanitizeMetadataType('Visio')).toBeNull()
    })

    it('rejette les types non-string (number, boolean, object, array, null, undefined)', () => {
        expect(sanitizeMetadataType(0)).toBeNull()
        expect(sanitizeMetadataType(1)).toBeNull()
        expect(sanitizeMetadataType(true)).toBeNull()
        expect(sanitizeMetadataType(false)).toBeNull()
        expect(sanitizeMetadataType({})).toBeNull()
        expect(sanitizeMetadataType({ toString: () => 'data' })).toBeNull()
        expect(sanitizeMetadataType([])).toBeNull()
        expect(sanitizeMetadataType(null)).toBeNull()
        expect(sanitizeMetadataType(undefined)).toBeNull()
    })

    it("rejette une chaîne très longue (anti-pollution de logs/clés de store)", () => {
        expect(sanitizeMetadataType('x'.repeat(10_000))).toBeNull()
    })
})
