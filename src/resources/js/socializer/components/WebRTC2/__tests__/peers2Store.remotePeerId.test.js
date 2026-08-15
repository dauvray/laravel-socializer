/**
 * peers2Store.remotePeerId.test.js
 *
 * Le store est PARTAGÉ par tous les contextes de l'onglet (`data-app` des notifications
 * + un contexte par MediaBroadcastProvider monté). Ce fichier fige les deux règles
 * d'indexation qui rendent ce partage sûr :
 *
 * 1. **Un peerId est un fait par onglet distant** (clé: slug), mais sa DURÉE DE VIE
 *    dépend de la présence : on ne l'oublie qu'une fois le pair absent de *toutes* les
 *    rooms déclarées (`roomMembers`). Le prédicat portait autrefois sur `connections`,
 *    qui décrit des connexions PeerJS et pas une présence : il était faux dès qu'une
 *    seconde room existait, et le peerId d'un onglet fermé survivait à jamais
 *    (« Could not connect to peer <uuid> » au retour du pair).
 * 2. **Une demande de peerId est un fait par contexte** (clé: slug|room|type). Indexée
 *    sur le slug seul, la demande du premier contexte faisait taire tous les autres.
 *
 * Deux verbes voisins, deux sémantiques à ne pas confondre :
 * - `removeRemotePeerId` — « ce pair a quitté la room » : soumis au prédicat de présence.
 * - `invalidateRemotePeerId` — « ce peerId est mort » (`peer-unavailable`) :
 *   inconditionnel, et purge toutes les demandes en vol pour que la re-demande qui suit
 *   ne soit pas étranglée par le throttle SIGNALING_STALE_MS.
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
        it('oublie le mapping quand le pair n\'est déclaré dans aucune room', () => {
            store.removeRemotePeerId('bob')

            expect(store.hasRemotePeerId('bob')).toBe(false)
        })

        it('conserve le mapping tant qu\'un contexte déclare le pair présent', () => {
            store.setRoomMembers('stream-room-test', ['bob'])

            store.removeRemotePeerId('bob')

            expect(store.getRemotePeerId('bob')).toBe('peer-bob')
        })

        it('oublie le mapping dès que le DERNIER contexte a retiré le pair', () => {
            store.setRoomMembers('data-room-chat', ['bob'])
            store.setRoomMembers('stream-room-test', ['bob'])

            store.setRoomMembers('data-room-chat', [])
            store.removeRemotePeerId('bob')
            expect(store.getRemotePeerId('bob')).toBe('peer-bob')

            store.setRoomMembers('stream-room-test', [])
            store.removeRemotePeerId('bob')
            expect(store.hasRemotePeerId('bob')).toBe(false)
        })

        it('ne dépend PAS de la map connections', () => {
            // Régression : `connections` servait de proxy à la présence. Un contexte
            // purgeant sa propre entrée APRÈS avoir appelé removeRemotePeerId, le
            // prédicat était vrai pour tout le monde et le verbe ne faisait jamais rien.
            store.connections = { app: { bob: { data: [] } } }

            store.removeRemotePeerId('bob')

            expect(store.hasRemotePeerId('bob')).toBe(false)
        })

        it('un contexte détruit ne témoigne plus de la présence de personne', () => {
            store.setRoomMembers('stream-room-test', ['bob'])
            store.clearRoomMembers('stream-room-test')

            store.removeRemotePeerId('bob')

            expect(store.hasRemotePeerId('bob')).toBe(false)
        })
    })

    describe('invalidateRemotePeerId (inconditionnel — peerId mort)', () => {
        it('supprime le mapping même si le pair est présent dans une autre room', () => {
            // Configuration réelle : le contexte data-app des notifications garde bob
            // présent en permanence.
            store.setRoomMembers('data-app', ['bob'])

            store.invalidateRemotePeerId('bob')

            expect(store.hasRemotePeerId('bob')).toBe(false)
        })

        it('purge les demandes en vol de TOUS les contextes', () => {
            // Le peerId est mort : aucune demande le concernant n'a plus d'objet, quel
            // que soit le contexte qui l'a émise.
            store.addWaitingRemotePeerId('bob', { room: 'room-chat', type: 'data' })
            store.addWaitingRemotePeerId('bob', { room: 'room-test', type: 'stream' })

            store.invalidateRemotePeerId('bob')

            expect(store.getWaitingRemotePeerIds('bob')).toEqual([])
        })

        it('est sans effet sur les autres pairs', () => {
            store.addRemotePeerId('alice', 'peer-alice')
            store.addWaitingRemotePeerId('alice', { room: 'room-test', type: 'stream' })

            store.invalidateRemotePeerId('bob')

            expect(store.getRemotePeerId('alice')).toBe('peer-alice')
            expect(store.getWaitingRemotePeerIds('alice')).toHaveLength(1)
        })

        it('est idempotent sur un slug inconnu', () => {
            expect(() => store.invalidateRemotePeerId('inconnu')).not.toThrow()
        })
    })

    describe('demandes de peerId en vol (clé slug|room|type)', () => {
        it('isole deux contextes qui demandent le même pair', () => {
            store.addWaitingRemotePeerId('bob', { room: 'room-chat', type: 'data' })

            // Le contexte `stream-room-test` ne voit PAS la demande du chat : c'est ce
            // qui l'autorise à émettre la sienne.
            expect(store.getWaitingRemotePeerId('bob', 'room-test', 'stream')).toBeNull()
            expect(store.getWaitingRemotePeerId('bob', 'room-chat', 'data')).toBeTruthy()
        })

        it('isole aussi le type dans une même room (écran vs type principal)', () => {
            store.addWaitingRemotePeerId('bob', { room: 'room-test', type: 'stream' })

            expect(store.hasWaitingRemotePeerId('bob', 'room-test', 'screen')).toBe(false)
            expect(store.hasWaitingRemotePeerId('bob', 'room-test', 'stream')).toBe(true)
        })

        it('retire une demande précise sans toucher aux voisines', () => {
            store.addWaitingRemotePeerId('bob', { room: 'room-chat', type: 'data' })
            store.addWaitingRemotePeerId('bob', { room: 'room-test', type: 'stream' })

            store.removeWaitingRemotePeerId('bob', 'room-test', 'stream')

            expect(store.getWaitingRemotePeerIds('bob').map((e) => e.room)).toEqual(['room-chat'])
        })

        it('purge par room quand un seul contexte se ferme', () => {
            store.addWaitingRemotePeerId('bob', { room: 'room-test', type: 'stream' })
            store.addWaitingRemotePeerId('bob', { room: 'room-test', type: 'screen' })
            store.addWaitingRemotePeerId('bob', { room: 'room-chat', type: 'data' })

            store.clearWaitingRemotePeerIds('bob', 'room-test')

            expect(store.getWaitingRemotePeerIds('bob').map((e) => e.room)).toEqual(['room-chat'])
        })

        it('horodate la demande — c\'est ce que lit le throttle SIGNALING_STALE_MS', () => {
            store.addWaitingRemotePeerId('bob', { room: 'room-test', type: 'stream' })

            const entry = store.getWaitingRemotePeerId('bob', 'room-test', 'stream')
            expect(entry.createdAt).toBeTypeOf('number')
            expect(entry.userSlug).toBe('bob')
        })
    })
})
