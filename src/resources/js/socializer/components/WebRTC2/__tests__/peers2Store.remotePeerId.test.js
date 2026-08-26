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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { REMOTE_PEER_ID_LEASE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

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

    /**
     * Le bail — REMOTE_PEER_ID_LEASE_MS.
     *
     * Un troisième régime, à ne pas confondre avec les deux verbes ci-dessus : l'existence
     * de l'entrée est gouvernée par la présence (`removeRemotePeerId`) et par le fait de
     * mort (`invalidateRemotePeerId`) ; le bail ne gouverne que la CONFIANCE accordée à
     * l'entrée pour composer un appel.
     *
     * Il ne supprime donc rien, et c'est structurel : le même mapping sert d'allowlist au
     * chemin (b) de `_isAuthorizedIncomingPeer` et d'index anti-usurpation par résolution
     * inverse. Une péremption qui supprimerait refermerait la visio 1-à-1 hors room, et une
     * résolution inverse périmable serait un contournement planifiable par l'attaquant.
     */
    describe('le bail (REMOTE_PEER_ID_LEASE_MS)', () => {
        beforeEach(() => {
            vi.useFakeTimers()
            // Ré-appris SOUS l'horloge factice : l'estampille du beforeEach parent a été
            // posée avec l'horloge réelle.
            store.addRemotePeerId('bob', 'peer-bob')
        })

        afterEach(() => {
            vi.useRealTimers()
        })

        it('horodate l\'entrée à l\'apprentissage', () => {
            expect(store.remotePeersId.get('bob').learnedAt).toBeTypeOf('number')
        })

        it('getRemotePeerId rend la chaîne nue, jamais l\'entrée', () => {
            // Garde de forme : c'est ce que lisent les deux gardes d'admission et une
            // trentaine d'assertions d'identité de la suite.
            expect(store.getRemotePeerId('bob')).toBeTypeOf('string')
            expect(store.getRemotePeerId('bob')).toBe('peer-bob')
        })

        it('autorise à composer tant que le bail court', () => {
            vi.advanceTimersByTime(REMOTE_PEER_ID_LEASE_MS - 1)

            expect(store.getDialableRemotePeerId('bob')).toBe('peer-bob')
        })

        it('n\'autorise plus à composer une fois le bail échu', () => {
            vi.advanceTimersByTime(REMOTE_PEER_ID_LEASE_MS + 1)

            expect(store.getDialableRemotePeerId('bob')).toBeFalsy()
        })

        it('⭐ un bail échu ne SUPPRIME rien — l\'entrée reste reconnue', () => {
            vi.advanceTimersByTime(REMOTE_PEER_ID_LEASE_MS + 1)

            // « Je ne compose plus » n'est pas « je ne reconnais plus » : l'entrée est
            // l'allowlist du chemin (b) de l'admission entrante.
            expect(store.hasRemotePeerId('bob')).toBe(true)
            expect(store.getRemotePeerId('bob')).toBe('peer-bob')
        })

        it('ré-apprendre la MÊME valeur renouvelle le bail', () => {
            // C'est ce qui fait qu'une room saine ne paie pas un aller-retour de
            // signalisation par minute : `connectToPeer` écrit à chaque preuve reçue.
            vi.advanceTimersByTime(REMOTE_PEER_ID_LEASE_MS - 1)
            store.addRemotePeerId('bob', 'peer-bob')

            vi.advanceTimersByTime(REMOTE_PEER_ID_LEASE_MS - 1)
            expect(store.getDialableRemotePeerId('bob')).toBe('peer-bob')
        })

        it('rend falsy sur un slug inconnu', () => {
            expect(store.getDialableRemotePeerId('inconnu')).toBeFalsy()
        })

        it('fail-closed : une entrée sans estampille n\'est pas composable', () => {
            // Ce qu'écrirait un double de test qui aurait oublié le tampon. Composer sur
            // la foi d'une entrée dont on ne sait pas l'âge est exactement ce que le bail
            // interdit.
            store.remotePeersId.set('carol', { peerId: 'peer-carol' })

            expect(store.getDialableRemotePeerId('carol')).toBeFalsy()
            expect(store.getRemotePeerId('carol')).toBe('peer-carol')
        })

        it('⭐ getSlugByRemotePeerId est AVEUGLE au bail', () => {
            vi.advanceTimersByTime(REMOTE_PEER_ID_LEASE_MS + 1)

            // Deux lecteurs en dépendent, et les deux casseraient en silence : la recovery
            // `peer-unavailable` (qui ne retrouverait plus le slug à invalider) et
            // l'anti-usurpation par résolution inverse de `_isAuthorizedIncomingPeer` —
            // qu'un attaquant n'aurait plus qu'à attendre pour la contourner.
            expect(store.getSlugByRemotePeerId('peer-bob')).toBe('bob')
        })

        it('getSlugByRemotePeerId rend null sur un peerId inconnu', () => {
            expect(store.getSlugByRemotePeerId('peer-fantome')).toBeNull()
        })

        it('getSlugByRemotePeerId rend le premier slug quand un peerId est mappé deux fois', () => {
            // Cas réel, et testé côté admission : deux slugs pour un même peerId est la
            // signature d'une usurpation, que `_isAuthorizedIncomingPeer` refuse sur la
            // contradiction. L'ordre d'insertion est celui de la Map.
            store.addRemotePeerId('mallory', 'peer-bob')

            expect(store.getSlugByRemotePeerId('peer-bob')).toBe('bob')
        })
    })
})
