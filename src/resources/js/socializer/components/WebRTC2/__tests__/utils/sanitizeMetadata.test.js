/**
 * sanitizeMetadata.test.js
 *
 * Tests unitaires de la sanitization des métadonnées PeerJS entrantes
 * (sanitizeMetadataType). Couvre la faille [FAIBLE] de l'audit du 2026-05-20 :
 * `conn.metadata.type` est contrôlé par le pair distant et était jusque-là
 * consommé directement comme clé de store et dans les logs.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeMetadataName, sanitizeMetadataType } from '~socializer/components/WebRTC2/Composables/utils/sanitizeMetadata.js'
import { MAX_METADATA_NAME_LENGTH, VALID_CONNECTION_TYPES } from '~socializer/components/WebRTC2/webrtc2.config.js'

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

/**
 * `fromName` est le seul champ de metadata rendu en texte dans l'interface
 * (`MediaBroadcastPlayer`), et il arrive brut du réseau. Pas de XSS — aucun `v-html`
 * dans le module, Vue échappe l'interpolation — mais une vignette peut être étirée
 * arbitrairement, et le nom part aussi dans les logs.
 *
 * Contrairement au type, il est TRONQUÉ et non rejeté : un nom trop long a un repli
 * utilisable (lui-même, coupé), un type hors liste blanche n'en a aucun.
 */
describe('sanitizeMetadataName', () => {
    it('laisse un nom nominal intact', () => {
        expect(sanitizeMetadataName('Alice Martin')).toBe('Alice Martin')
    })

    it('tronque au-delà de MAX_METADATA_NAME_LENGTH', () => {
        const long = 'x'.repeat(MAX_METADATA_NAME_LENGTH + 500)

        const sanitized = sanitizeMetadataName(long)

        expect(sanitized).toHaveLength(MAX_METADATA_NAME_LENGTH)
        expect(sanitized).toBe('x'.repeat(MAX_METADATA_NAME_LENGTH))
    })

    it('tronque exactement à la borne, sans off-by-one', () => {
        expect(sanitizeMetadataName('y'.repeat(MAX_METADATA_NAME_LENGTH)))
            .toHaveLength(MAX_METADATA_NAME_LENGTH)
        expect(sanitizeMetadataName('y'.repeat(MAX_METADATA_NAME_LENGTH + 1)))
            .toHaveLength(MAX_METADATA_NAME_LENGTH)
    })

    it('rend null sur une chaîne vide ou blanche (l\'appelant pose son repli)', () => {
        expect(sanitizeMetadataName('')).toBeNull()
        expect(sanitizeMetadataName('   ')).toBeNull()
        expect(sanitizeMetadataName('\n\t')).toBeNull()
    })

    it('rogne les blancs de bord avant de mesurer', () => {
        expect(sanitizeMetadataName('  Alice  ')).toBe('Alice')
    })

    it('rend null sur les types non-string', () => {
        expect(sanitizeMetadataName(42)).toBeNull()
        expect(sanitizeMetadataName(true)).toBeNull()
        expect(sanitizeMetadataName({})).toBeNull()
        expect(sanitizeMetadataName({ toString: () => 'Alice' })).toBeNull()
        expect(sanitizeMetadataName([])).toBeNull()
        expect(sanitizeMetadataName(null)).toBeNull()
        expect(sanitizeMetadataName(undefined)).toBeNull()
    })
})
