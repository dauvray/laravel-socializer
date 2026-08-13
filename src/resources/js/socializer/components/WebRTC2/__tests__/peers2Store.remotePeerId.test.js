/**
 * peers2Store.remotePeerId.test.js
 *
 * Deux verbes voisins, deux sémantiques à ne pas confondre :
 *
 * - `removeRemotePeerId` — « ce pair a quitté cette room » : **conditionnel**, il garde le
 *   mapping tant que le pair apparaît dans une autre room. Voulu : plusieurs contextes
 *   (data-app des notifications + stream-*) partagent ce store, et un pair encore connecté
 *   ailleurs a toujours besoin de son peerId.
 * - `invalidateRemotePeerId` — « ce peerId est mort » (`peer-unavailable`) : **inconditionnel**,
 *   et purge aussi le drapeau d'attente pour que la re-demande de signalisation qui suit ne
 *   soit pas étranglée par le throttle SIGNALING_STALE_MS.
 *
 * C'est la confusion entre les deux qui rendait un peerId périmé « collant » (bug du
 * 2026-08-13 : un arrivant ne recevait jamais le flux).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { usePeer2Store } from '~socializer/stores/peers2.js'

describe('peers2 — cycle de vie des peerId distants', () => {
    let store

    beforeEach(() => {
        store = usePeer2Store()
        store.addRemotePeerId('bob', 'peer-bob')
    })

    describe('removeRemotePeerId (conditionnel — départ de room)', () => {
        it('supprime le mapping quand le pair n\'est plus dans aucune room', () => {
            store.removeRemotePeerId('bob')

            expect(store.hasRemotePeerId('bob')).toBe(false)
        })

        it('conserve le mapping tant que le pair figure dans une room', () => {
            store.connections = { app: { bob: { data: [] } } }

            store.removeRemotePeerId('bob')

            expect(store.getRemotePeerId('bob')).toBe('peer-bob')
        })
    })

    describe('invalidateRemotePeerId (inconditionnel — peerId mort)', () => {
        it('supprime le mapping même si le pair est connecté dans une autre room', () => {
            // Configuration réelle : le contexte data-app des notifications garde bob
            // dans connections['app'] en permanence.
            store.connections = { app: { bob: { data: [] } } }

            store.invalidateRemotePeerId('bob')

            expect(store.hasRemotePeerId('bob')).toBe(false)
        })

        it('purge aussi le drapeau d\'attente', () => {
            store.addWaitingRemotePeerId('bob', { room: 'live', type: 'stream' })

            store.invalidateRemotePeerId('bob')

            expect(store.hasWaitingRemotePeerId('bob')).toBe(false)
        })

        it('est sans effet sur les autres pairs', () => {
            store.addRemotePeerId('alice', 'peer-alice')

            store.invalidateRemotePeerId('bob')

            expect(store.getRemotePeerId('alice')).toBe('peer-alice')
        })

        it('est idempotent sur un slug inconnu', () => {
            expect(() => store.invalidateRemotePeerId('inconnu')).not.toThrow()
        })
    })
})
