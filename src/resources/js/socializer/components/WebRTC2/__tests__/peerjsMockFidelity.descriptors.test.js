/**
 * peerjsMockFidelity.descriptors.test.js — Ce que la vraie lib interdit d'écrire
 *
 * `mockFidelity.test.js` compare les SURFACES (tel nom existe-t-il des deux côtés ?). Ce
 * fichier compare la seule chose que la surface ne dit pas : **ce qui est en lecture seule.**
 *
 * ── Pourquoi un fichier entier pour ça ────────────────────────────────────────────────────
 *
 * `usePeerTransport` a porté pendant des mois un `peer.id = …` placé juste avant
 * `peer.reconnect()`. `id` est un accesseur SANS setter dans `peerjs` 1.5.4, et un module ES
 * est en mode strict : dans le navigateur, cette ligne levait une `TypeError` et emportait le
 * `reconnect()` avec elle — aucune reconnexion PeerJS n'aboutissait jamais. Le mock, lui,
 * portait `id` en propriété simple : l'assignation y était inoffensive et la suite restait
 * verte. Un bug de production **structurellement invisible en test**.
 *
 * Le correctif ponctuel (rendre `id` accesseur dans le mock) ferme UN cas. Il en restait six
 * ouverts, exposés au même accident. Ce fichier ferme la classe : il n'épingle pas une ligne
 * de production, il rend impossible de perdre à nouveau ce delta.
 *
 * ── Comment on lit la vraie classe ────────────────────────────────────────────────────────
 *
 * ⚠️ `vitest.config.js` détourne le spécifieur `peerjs` vers ce dossier `__mocks__`. La vraie
 * classe est donc importée par **chemin absolu**, qui ne matche pas l'alias.
 *
 * ⚠️ Aucune instance réelle n'est construite : `new Peer()` ouvre un WebSocket. `Object.create`
 * sur le prototype suffit — les accesseurs vivent sur le prototype, pas sur l'instance.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Peer as MockPeer, resetPeerMock } from './__mocks__/peerjs.js'
import { Peer as RealPeer } from '/var/www/estarter-test/node_modules/peerjs/dist/bundler.mjs'
import BUNDLER_SOURCE from '/var/www/estarter-test/node_modules/peerjs/dist/bundler.mjs?raw'

/**
 * Les sept accesseurs du vrai `Peer` (`dist/bundler.mjs:1460-1492`).
 *
 * La liste est écrite en dur À DESSEIN : un test qui découvrirait les propriétés en parcourant
 * le prototype réel passerait au vert le jour où une mise à jour de `peerjs` en retire une —
 * exactement le silence qu'on cherche à supprimer. Ici, une divergence de la lib rougit.
 */
const READONLY_ACCESSORS = ['id', 'options', 'open', 'socket', 'connections', 'destroyed', 'disconnected']

/** Le descripteur de `prop`, cherché sur l'objet puis toute sa chaîne de prototypes. */
const resolveDescriptor = (target, prop) => {
    let cursor = target
    while (cursor) {
        const descriptor = Object.getOwnPropertyDescriptor(cursor, prop)
        if (descriptor) return descriptor
        cursor = Object.getPrototypeOf(cursor)
    }
    return null
}

describe('fidélité du mock PeerJS — propriétés en lecture seule', () => {
    beforeEach(() => {
        resetPeerMock()
    })

    describe('la vraie classe est bien la référence qu\'on croit', () => {
        it('expose les sept propriétés en accesseur sans setter', () => {
            // Si ce test rougit, ce n'est pas le mock qui a bougé mais `peerjs` : relire
            // `READONLY_ACCESSORS` avant de toucher au mock.
            READONLY_ACCESSORS.forEach((prop) => {
                const descriptor = Object.getOwnPropertyDescriptor(RealPeer.prototype, prop)

                expect(descriptor, `Peer.prototype.${prop} (vraie lib)`).toBeTruthy()
                expect(typeof descriptor.get, `get ${prop}() (vraie lib)`).toBe('function')
                expect(descriptor.set, `set ${prop}() (vraie lib)`).toBeUndefined()
            })
        })

        it('refuse réellement l\'écriture, en mode strict', () => {
            // La preuve de l'effet, pas seulement de la forme : c'est cette levée qui a sauté
            // le `reconnect()` en production. Pas d'instance réelle — le prototype suffit.
            const detached = Object.create(RealPeer.prototype)

            READONLY_ACCESSORS.forEach((prop) => {
                expect(
                    () => { detached[prop] = 'écriture interdite' },
                    `${prop} = … (vraie lib)`
                ).toThrow(TypeError)
            })
        })
    })

    describe('le mock reproduit ces interdits', () => {
        it('expose les sept propriétés en accesseur sans setter', () => {
            const peer = new MockPeer('mock-alice')

            READONLY_ACCESSORS.forEach((prop) => {
                const descriptor = resolveDescriptor(peer, prop)

                // Une propriété ABSENTE est un échec au même titre qu'une propriété
                // inscriptible : `peer.socket = …` y créerait une propriété d'instance en
                // silence, là où la vraie classe lève.
                expect(descriptor, `mock ${prop} : propriété absente`).toBeTruthy()
                expect(typeof descriptor.get, `get ${prop}() (mock)`).toBe('function')
                expect(descriptor.set, `set ${prop}() (mock)`).toBeUndefined()
            })
        })

        it('refuse réellement l\'écriture, en mode strict', () => {
            const peer = new MockPeer('mock-alice')

            READONLY_ACCESSORS.forEach((prop) => {
                expect(
                    () => { peer[prop] = 'écriture interdite' },
                    `${prop} = … (mock)`
                ).toThrow(TypeError)
            })
        })

        it('les sept accesseurs rendent une valeur, pas `undefined` par oubli', () => {
            // Un accesseur en lecture seule qui rendrait toujours `undefined` satisferait les
            // deux tests ci-dessus sans rien simuler.
            const peer = new MockPeer('mock-alice', { host: 'localhost', port: 443 })

            expect(peer.id).toBe('mock-alice')
            expect(peer.options).toEqual({ host: 'localhost', port: 443 })
            expect(peer.open).toBe(false)
            expect(peer.socket).toBeNull()
            expect(peer.connections).toEqual({})
            expect(peer.destroyed).toBe(false)
            expect(peer.disconnected).toBe(false)
        })
    })

    describe('`options.config`, le point d\'appui du rafraîchissement TURN', () => {
        /**
         * Ce bloc n'épingle pas le mock : il épingle un INTERNE DE PEERJS dont dépend du code de
         * production.
         *
         * `_refreshIceConfig` (usePeerTransport) renouvelle le credential TURN d'un onglet en
         * réécrivant `peer.options.config`, et RIEN D'AUTRE — ni `setConfiguration()`, ni cycle
         * destroy → init. Ça ne marche que grâce à deux propriétés de la lib :
         *
         *   1. PeerJS relit `provider.options.config` à CHAQUE nouvelle `RTCPeerConnection`, donc
         *      une réécriture profite à toutes les connexions futures sans toucher aux ouvertes ;
         *   2. `options` est un getter vivant sur `_options`, donc muter l'objet rendu mute bien la
         *      source.
         *
         * Aucune des deux n'est contractuelle. Le jour où une mise à jour de `peerjs` renomme ce
         * chemin, le rafraîchissement devient MUET : aucune erreur, aucun log, et la panne revient
         * sous sa forme d'origine — « la visio ne passe plus, un F5 la répare » — des mois plus tard,
         * chez un utilisateur qui laisse son onglet ouvert. C'est ce silence-là que ces deux tests
         * transforment en suite rouge.
         */
        it('la vraie lib lit `provider.options.config` pour construire ses RTCPeerConnection', () => {
            // Sur la SOURCE et non sur le comportement : l'observer autrement demanderait une vraie
            // négociation ICE. Le compromis est assumé — ce test ne prouve pas que ça marche, il
            // détecte que le chemin a bougé, ce qui est exactement ce dont on a besoin.
            expect(BUNDLER_SOURCE.length, 'source de bundler.mjs illisible').toBeGreaterThan(1000)
            expect(BUNDLER_SOURCE).toMatch(/provider\.options\.config/)
        })

        it('muter `options.config` est observable — l\'objet rendu par le getter n\'est pas figé', () => {
            const detached = Object.create(RealPeer.prototype)
            const initiale = { iceServers: [{ urls: 'stun:un.example' }] }
            detached._options = { config: initiale }

            expect(detached.options.config).toBe(initiale)

            // ⚠️ On mute la PROPRIÉTÉ `config` de l'objet d'options, on ne réassigne pas `options`
            // lui-même — qui est en lecture seule (cf. les blocs ci-dessus). C'est la distinction
            // exacte que `_refreshIceConfig` respecte.
            const fraiche = { iceServers: [{ urls: 'turn:deux.example' }] }
            detached.options.config = fraiche

            expect(detached.options.config).toBe(fraiche)
            expect(detached._options.config).toBe(fraiche)
        })

        it('le mock reproduit ce point d\'appui', () => {
            // Sans quoi `usePeerTransport.iceRefresh.test.js` mesurerait une mécanique que la vraie
            // lib n'a pas — le mode de panne que tout ce fichier existe pour fermer.
            const peer = new MockPeer('mock-alice', { config: { iceServers: [] } })
            const fraiche = { iceServers: [{ urls: 'turn:deux.example' }] }

            peer.options.config = fraiche

            expect(peer.options.config).toBe(fraiche)
        })
    })

    describe('les verbes qui remplacent les écritures', () => {
        it('`_markDestroyed()` pose le drapeau sans jouer la cascade de `destroy()`', () => {
            const peer = new MockPeer('mock-alice')
            peer.on('disconnected', () => { throw new Error('cascade jouée') })

            peer._markDestroyed()

            // C'est tout l'intérêt du verbe : `destroy()` émet `disconnected` AVANT de poser le
            // drapeau (fidèle à `bundler.mjs:1776-1783`), ce qui déclencherait le chemin de
            // reconnexion qu'un test de garde veut précisément voir rester inerte.
            expect(peer.destroyed).toBe(true)
            expect(peer.disconnected).toBe(false)
        })

        it('`_triggerEvent(\'open\', id)` ouvre le peer et efface la déconnexion', () => {
            const peer = new MockPeer('mock-alice')
            peer.disconnect()

            peer._triggerEvent('open', 'peer-attribué')

            expect(peer.id).toBe('peer-attribué')
            expect(peer.open).toBe(true)
            expect(peer.disconnected).toBe(false)
        })
    })
})
