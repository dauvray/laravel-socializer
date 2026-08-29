/**
 * peers2Store.attestedPeers.test.js — le registre des attestations vérifiées, et sa frontière
 *
 * ⚠️ **CE FICHIER EXISTE POUR UNE SEULE RAISON, et elle tient en une phrase : `attestedPeers` ne
 * doit JAMAIS devenir une allowlist.** Il dit QUI est en face, jamais si cette personne a le droit
 * d'entrer.
 *
 * Le mode de panne visé est daté, et il a déjà coûté une faille : l'écriture inconditionnelle
 * d'`addRemotePeerId` sur la signalisation empoisonnait le mapping qui sert d'allowlist au chemin
 * (b) de `_isAuthorizedIncomingPeer` — un attaquant s'y inscrivait comme « interlocuteur d'appel
 * direct vérifié » sans qu'aucun appel n'ait été autorisé. Le correctif fut un REGISTRE DISTINCT
 * (`authorizedCallPeers`). Verser un verdict d'attestation dans `remotePeersId` rouvrirait
 * exactement cette porte, par un autre couloir — et le contexte `data-app`, monté en permanence
 * pour tout connecté, la rend atteignable en continu.
 *
 * Aucune assertion de VALEUR ne peut voir cette fusion : les deux registres rendent des identités
 * justes, et la faille n'apparaîtrait qu'à l'admission d'un pair qui n'aurait jamais dû l'être.
 * D'où la seconde section, mécanique, sur le même patron que `roomMembersSourceOfTruth.test.js`.
 *
 * Contrôles de harnais (convention du paquet), mesurés le 2026-08-29 :
 *   - faire lire `attestedPeers` à `getRemotePeerId` rougit **1 cas** (la section « frontière ») ;
 *   - retirer la garde d'échéance de `getAttestedPeer` rougit **2 cas** ;
 *   - faire écrire `noteAttestedPeer` dans `remotePeersId` rougit **2 cas**.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { ATTESTATION_REFRESH_MARGIN_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

// Sources de production du module — jamais les tests ni les helpers. Même périmètre que
// `roomMembersSourceOfTruth.test.js`, dont ce fichier est le voisin de méthode.
const SOURCES = import.meta.glob(
    ['../Composables/**/*.js', '../Widgets/**/*.js', '../Widgets/**/*.vue', '../Exemples/**/*.vue'],
    { query: '?raw', import: 'default', eager: true }
)

const PEER_ID = 'peer-bob-neuf'

describe('attestedPeers — le registre des identités vérifiées', () => {
    let store

    beforeEach(() => {
        store = usePeer2Store()
        store.attestedPeers.clear()
        store.remotePeersId.clear()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('mémorisation', () => {
        it('rend le verdict tant que son échéance court', () => {
            store.noteAttestedPeer(PEER_ID, 'bob', Date.now() + 60_000)

            expect(store.getAttestedPeer(PEER_ID)?.slug).toBe('bob')
        })

        it('mémorise aussi les REFUS — `{ slug: null }` n\'est pas une absence de verdict', () => {
            // Sans cela, un pair refusé qui insiste ferait payer un aller-retour à chacune de ses
            // tentatives, à la cadence qu'il choisit. `undefined` (rien en cache) et
            // `{ slug: null }` (refusé) sont donc deux valeurs distinctes, et l'appelant s'appuie
            // dessus pour ne pas redemander.
            store.noteAttestedPeer(PEER_ID, null, Date.now() + 60_000)

            expect(store.getAttestedPeer(PEER_ID)).toEqual({ slug: null, expiresAt: expect.any(Number) })
            expect(store.getAttestedPeer(PEER_ID)).not.toBeUndefined()
        })

        it('cesse de rendre un verdict périmé, SANS le supprimer', () => {
            // Il filtre une LECTURE. Purger ici serait une écriture déclenchée par un lecteur, et
            // le verdict suivant réécrit l'entrée de toute façon.
            vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
            store.noteAttestedPeer(PEER_ID, 'bob', 1_000_000 + ATTESTATION_REFRESH_MARGIN_MS)

            Date.now.mockReturnValue(1_000_000 + ATTESTATION_REFRESH_MARGIN_MS)

            expect(store.getAttestedPeer(PEER_ID)).toBeUndefined()
            expect(store.attestedPeers.has(PEER_ID)).toBe(true)
        })

        it('refuse une entrée sans peerId, et normalise un slug vide en refus', () => {
            store.noteAttestedPeer('', 'bob', Date.now() + 60_000)
            store.noteAttestedPeer(null, 'bob', Date.now() + 60_000)
            expect(store.attestedPeers.size).toBe(0)

            store.noteAttestedPeer(PEER_ID, '', Date.now() + 60_000)
            expect(store.getAttestedPeer(PEER_ID)?.slug).toBeNull()
        })

        it('fail-closed sur une échéance non numérique', () => {
            // C'est ce qu'écrirait un double de test qui aurait oublié le tampon. Se fier à un
            // verdict dont on ignore l'âge est exactement ce que cette lecture interdit — même
            // doctrine que `getDialableRemotePeerId`.
            store.noteAttestedPeer(PEER_ID, 'bob', undefined)

            expect(store.getAttestedPeer(PEER_ID)).toBeUndefined()
        })
    })

    describe('frontière avec l\'allowlist du chemin (b)', () => {
        it('un verdict n\'inscrit RIEN dans `remotePeersId`', () => {
            // ⚠️ LE POINT DE SÉCURITÉ. Une inscription ici ferait d'un pair attesté un
            // « interlocuteur d'appel direct vérifié » sans qu'aucun appel n'ait été autorisé.
            store.noteAttestedPeer(PEER_ID, 'bob', Date.now() + 60_000)

            expect(store.remotePeersId.size).toBe(0)
            expect(store.getRemotePeerId('bob')).toBeUndefined()
            expect(store.hasRemotePeerId('bob')).toBe(false)
            expect(store.getDialableRemotePeerId('bob')).toBeUndefined()
        })

        it('les deux registres restent indépendants dans l\'autre sens aussi', () => {
            store.addRemotePeerId('bob', 'peer-bob')

            expect(store.attestedPeers.size).toBe(0)
            expect(store.getAttestedPeer('peer-bob')).toBeUndefined()
        })

        it('AUCUNE source de production ne lit `attestedPeers` en dehors de la résolution d\'identité', () => {
            // Le garde mécanique, et le seul qui survive à une relecture distraite : une assertion
            // de valeur ne verrait pas la fusion, puisque les deux registres rendent des identités
            // justes. Le lecteur autorisé est unique — `usePeerTransport`, qui porte à la fois
            // `_resolveSenderSlugFromIncomingConn` et `_attestedSlugFor`.
            const lecture = /(getAttestedPeer|attestedPeers)\b/
            const lecteurs = Object.entries(SOURCES)
                .filter(([, source]) => lecture.test(String(source)))
                .map(([path]) => path.replace('../', ''))

            expect(lecteurs).toEqual(['Composables/usePeerTransport.js'])
        })

        it('AUCUNE source de production n\'écrit un verdict d\'attestation dans le mapping', () => {
            // La forme exacte de la rechute : `addRemotePeerId(slug, conn.peer)` posé après une
            // vérification réussie, « puisqu'on connaît maintenant son peerId ». Ce serait
            // l'auto-inscription remise en service.
            const ecriture = /addRemotePeerId\s*\(/g
            const ecrivains = new Set()

            for (const [path, source] of Object.entries(SOURCES)) {
                if (String(source).match(ecriture)) { ecrivains.add(path.replace('../', '')) }
            }

            // Les trois écrivains historiques, chacun derrière son garde, et EUX SEULS :
            // `usePeerConnections.connectToPeer` plus les deux de `useCallManager`.
            expect([...ecrivains].sort()).toEqual([
                'Composables/useCallManager.js',
                'Composables/usePeerConnections.js',
            ])
        })
    })
})
