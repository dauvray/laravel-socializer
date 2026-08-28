/**
 * peers2Store.peerObservability.test.js — `peerIdentity` et les contradictions nommées
 *
 * Six prédicats répondaient chacun à sa façon à « ai-je un peer utilisable, et quel est son
 * id ? » — `localPeer`, `localPeerReady`, `lastLocalPeerId`, `peerInitPromise`,
 * `localPeer.disconnected`, `localPeer.destroyed` —, ils divergeaient, et cette divergence est
 * la cause commune de la plupart des pannes du module. `peerIdentity` les a d'abord
 * réconciliés pour qu'on puisse MESURER ; il est désormais **le seul chemin de lecture** de la
 * production, et les deux prédicats déclarés ont fusionné en une phase (`peerPhase`).
 *
 * Ce fichier existe parce que la mesure a manqué. Le churn de peers de la nuit du 24/08 a été
 * établi en croisant à la main les logs Docker du serveur PeerJS avec les `GET /app` de nginx —
 * faute d'un seul endroit disant « voilà l'état du Peer, et voilà en quoi il se contredit ».
 *
 * ⚠️ Les cinq violations ne sont pas une liste défensive : chacune est produite par un chemin
 * identifié du code, et l'une d'elles est un état que le code laisse SCIEMMENT (cf.
 * `id-historique-sans-peer`). Depuis la FSM, elles ont un second rôle : confronter le DÉCLARÉ
 * (la phase) à l'OBSERVÉ (`destroyed` / `disconnected`, écrits par PeerJS) — c'est ce qui
 * empêche la phase de mentir à son tour.
 *
 * ⚠️ **Convention de semis de ce fichier** : un état ATTEIGNABLE se sème par les transitions
 * (`markPeerCreating` → `markPeerConnecting` → `markPeerOpen`), un état CONTRADICTOIRE par
 * affectation directe de `peerPhase` — précisément parce qu'aucune transition ne le produit.
 * Le mélange n'est pas un relâchement : semer une contradiction par un verbe de transition
 * ferait journaliser un enchaînement impossible et masquerait le vrai sujet du test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { PEER_PHASES } from '~socializer/stores/peers2/phases.js'
import { createMockContext } from './helpers/createMockContext.js'

/** Un double de Peer réduit aux trois drapeaux que `peerIdentity` interroge. */
const fakePeer = (id = 'peer-alice', { destroyed = false, disconnected = false } = {}) => ({
    id, destroyed, disconnected,
})

describe('peers2 — observabilité de l\'état du Peer', () => {
    let store

    beforeEach(() => {
        store = usePeer2Store()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('peerIdentity — les six états', () => {
        it('`absent` : ni peer, ni init en vol', () => {
            expect(store.peerIdentity()).toEqual({
                state: 'absent', id: null, lastId: null, consumers: 0,
            })
        })

        it('`creating` : pas de peer, mais une init en vol', () => {
            // ⭐ L'état qui n'existait pas avant l'aller-retour ICE, et qui a produit le peer
            // orphelin : `localPeer` est null ALORS QUE l'init est en cours. Sans ce nom, il
            // était indistinguable de `absent` — et c'est précisément l'écart que la garde
            // d'annulation de `_doInit` exploite.
            store.markPeerCreating()

            expect(store.peerIdentity().state).toBe('creating')
        })

        it('`connecting` : le Peer existe, son `open` n\'est pas arrivé', () => {
            store.localPeer = fakePeer()

            expect(store.peerIdentity()).toEqual({
                state: 'connecting', id: 'peer-alice', lastId: null, consumers: 0,
            })
        })

        it('`ready` : le Peer est ouvert', () => {
            store.localPeer = fakePeer()
            store.markPeerCreating()
            store.markPeerConnecting()
            store.markPeerOpen('peer-alice')
            store.addPeerConsumer({})

            expect(store.peerIdentity()).toEqual({
                state: 'ready', id: 'peer-alice', lastId: 'peer-alice', consumers: 1,
            })
        })

        it('`disconnected` : socket tombé — et `id` divorce de `lastId`', () => {
            // ⭐ LE fait que rien ne rendait lisible. `Peer.disconnect()` met `_id` à `null`
            // (peerjs 1.5.4, `dist/bundler.mjs:1809`) et laisse `lastLocalPeerId` posé.
            // `waitForMeReady` lit le second et répond « prêt » quand le premier ne vaut
            // plus rien : l'onglet se croit joignable et ne répond plus à aucune demande de
            // peerId, sans le moindre signe.
            store.localPeer = fakePeer(null, { disconnected: true })
            store.lastLocalPeerId = 'peer-alice'

            expect(store.peerIdentity()).toEqual({
                state: 'disconnected', id: null, lastId: 'peer-alice', consumers: 0,
            })
        })

        it('`destroyed` l\'emporte sur `disconnected`', () => {
            // L'ordre des tests compte : `destroy()` appelle `disconnect()`, donc les deux
            // drapeaux sont vrais ensemble. Le plus terminal des deux doit gagner, sinon une
            // destruction se lit comme une coupure réseau — l'exacte confusion qui faisait
            // traiter chaque teardown comme un incident.
            store.localPeer = fakePeer('peer-alice', { destroyed: true, disconnected: true })

            expect(store.peerIdentity().state).toBe('destroyed')
        })

        it('n\'expose un `id` que s\'il est une chaîne', () => {
            // Sous l'ancienne arité `new Peer({ host, … })`, `id` portait l'OBJET d'options
            // jusqu'à l'`open`. Un observateur qui le relaierait tel quel journaliserait un
            // objet là où le serveur PeerJS n'indexe que des chaînes.
            store.localPeer = { id: { host: 'localhost' }, destroyed: false, disconnected: false }

            expect(store.peerIdentity().id).toBeNull()
        })
    })

    describe('peerStateViolations — les contradictions', () => {
        const codes = () => store.peerStateViolations().map((v) => v.code)

        it('ne signale rien sur un état cohérent', () => {
            store.localPeer = fakePeer()
            store.markPeerCreating()
            store.markPeerConnecting()
            store.markPeerOpen('peer-alice')
            store.addPeerConsumer({})

            expect(store.peerStateViolations()).toEqual([])
        })

        it('`pret-sans-peer` : prêt alors qu\'il n\'y a pas de peer', () => {
            store.peerPhase = PEER_PHASES.READY

            expect(codes()).toContain('pret-sans-peer')
        })

        it('`id-historique-sans-peer` : l\'état que le `.catch` d\'init laisse', () => {
            // ⚠️ Cet état est VOULU par le code actuel : le `.catch` de `_doInit` nulle
            // `localPeer` et préserve `lastLocalPeerId`, parce que `waitForMeReady` en dépend.
            // Le nommer ne le corrige pas — il rend visible que « prêt » y est vrai pour
            // `waitForMeReady` et faux pour tous les autres lecteurs.
            store.lastLocalPeerId = 'peer-alice'

            expect(codes()).toContain('id-historique-sans-peer')
        })

        it('`id-historique-sans-peer` se TAIT pendant une init en vol', () => {
            // Sinon l'audit crierait à chaque aller-retour ICE : pendant `creating`,
            // « pas de peer » est l'état normal, pas une contradiction. Un outil qui hurle
            // sur du normal n'est plus lu.
            store.lastLocalPeerId = 'peer-alice'
            store.markPeerCreating()

            expect(codes()).not.toContain('id-historique-sans-peer')
        })

        it('`pret-sans-id` : prêt sur un peer sans id utilisable', () => {
            store.localPeer = fakePeer(null, { disconnected: true })
            store.peerPhase = PEER_PHASES.READY

            expect(codes()).toContain('pret-sans-id')
        })

        it('`id-historique-sur-peer-inutilisable` : peer déconnecté, plus rien d\'armé', () => {
            // ⭐ LA panne silencieuse du module, et la seule des six qui ne produise AUCUN
            // signal aujourd'hui. `waitForMeReady` ne consulte que `lastLocalPeerId` — un fait
            // historique : il répond « prêt » sur un peer fini. Tout ce qui en découle publie
            // ou attend un peerId que le serveur PeerJS ne connaît plus, et en face c'est
            // « Could not connect to peer <uuid> » pendant que l'arrivant ne voit rien.
            store.localPeer = fakePeer(null, { disconnected: true })
            store.lastLocalPeerId = 'peer-alice'

            expect(codes()).toContain('id-historique-sur-peer-inutilisable')
        })

        it('se tait pendant un backoff en vol — la coupure est transitoire', () => {
            vi.useFakeTimers()
            store.localPeer = fakePeer(null, { disconnected: true })
            store.lastLocalPeerId = 'peer-alice'
            store.peerReconnectTimer = setTimeout(() => {}, 1000)

            // Le prédicat DOIT exclure ce cas, et pas par prudence : pendant un backoff,
            // `lastLocalPeerId` est exactement ce dont `reconnect()` repart
            // (`peer._lastServerId = peerStore.lastLocalPeerId`). Le signaler ferait crier
            // l'audit à chaque micro-coupure réseau, et un outil qui crie sur du normal
            // cesse d'être lu — c'est comme ça qu'on perd un signal.
            expect(codes()).not.toContain('id-historique-sur-peer-inutilisable')

            store.clearReconnectTimer()
            vi.useRealTimers()
        })

        it('signale un peer DÉTRUIT même sans backoff, timer ou pas', () => {
            vi.useFakeTimers()
            store.localPeer = fakePeer('peer-alice', { destroyed: true })
            store.lastLocalPeerId = 'peer-alice'
            store.peerReconnectTimer = setTimeout(() => {}, 1000)

            // Un peer détruit ne se reconnecte JAMAIS : `reconnect()` lève sur une instance
            // détruite (peerjs 1.5.4, `dist/bundler.mjs:1825`). Un backoff en vol n'y est pas
            // un recours, c'est un timer qui ne servira à rien.
            expect(codes()).toContain('id-historique-sur-peer-inutilisable')

            store.clearReconnectTimer()
            vi.useRealTimers()
        })

        it('`pret-mais-detruit` : prêt sur un peer détruit', () => {
            store.localPeer = fakePeer('peer-alice', { destroyed: true })
            store.peerPhase = PEER_PHASES.READY

            expect(codes()).toContain('pret-mais-detruit')
        })

        it('`peer-orphelin` : un peer vivant, aucun consommateur, aucune destruction armée', () => {
            // ⭐ La famille du « peerId fantôme », et la violation la plus opérationnelle des
            // cinq : un Peer que plus personne ne consomme et qu'aucun timer ne viendra
            // détruire est hors d'atteinte de toute destruction future. Sa socket vit jusqu'à
            // `alive_timeout` (60 s) côté serveur, et un pair qui détient son id y envoie des
            // offres dans le vide — sans erreur, sans trace. Mesuré en production : 6 peers
            // simultanés pour 2 navigateurs, trois survivants au-delà de 105 s.
            store.localPeer = fakePeer()

            expect(codes()).toContain('peer-orphelin')
        })

        it('`peer-orphelin` se tait quand une destruction est armée', () => {
            vi.useFakeTimers()
            store.localPeer = fakePeer()
            store.peerDestroyTimer = setTimeout(() => {}, 10_000)

            // Le délai de grâce de `PEER_DESTROY_DELAY_MS` est un état LÉGITIME à zéro
            // consommateur : le peer est en sursis, pas orphelin.
            expect(codes()).not.toContain('peer-orphelin')

            store.clearPeerDestroyTimer()
            vi.useRealTimers()
        })

        it('un peer détruit n\'est jamais orphelin', () => {
            store.localPeer = fakePeer('peer-alice', { destroyed: true })

            // Il n'y a plus rien à détruire : le signaler serait un faux positif permanent
            // sur tout le reste de la vie du store.
            expect(codes()).not.toContain('peer-orphelin')
        })

        it('cumule les contradictions plutôt que de s\'arrêter à la première', () => {
            // Un audit qui rendrait la première contradiction ferait croire à un défaut
            // unique là où l'état est incohérent sur plusieurs axes — et le second serait
            // découvert seulement après correction du premier.
            store.localPeer = fakePeer(null, { destroyed: true })
            store.peerPhase = PEER_PHASES.READY

            expect(codes()).toEqual(
                expect.arrayContaining(['pret-sans-id', 'pret-mais-detruit'])
            )
        })
    })

    // ── Le mock du store DUPLIQUE cette logique ──────────────────────────────────
    //
    // `createMockContext` réimplémente `peerIdentity` et `peerStateViolations` : le transport
    // les appelle, et un mock qui rendrait un état constant ferait taire l'audit exactement là
    // où il doit crier. Cette duplication est assumée — mais deux copies d'un même fait
    // divergent toujours, alors elles sont confrontées ici.
    //
    // ⚠️ C'est le mode de panne nº1 recensé en tête de `mockFidelity.test.js` : ce fichier-là
    // garantit la SURFACE (le nom existe des deux côtés), jamais la sémantique. Sans le bloc
    // ci-dessous, le mock pourrait rendre `[]` en toutes circonstances et rester « fidèle ».

    describe('le mock du store dit exactement la même chose', () => {
        /** Les six états et les six contradictions, en un seul jeu. */
        const CASES = [
            { name: 'absent', apply: () => ({}) },
            { name: 'creating', apply: (s) => { s.markPeerCreating() } },
            { name: 'connecting', apply: (s) => { s.localPeer = fakePeer() } },
            {
                name: 'ready',
                apply: (s, token) => {
                    s.localPeer = fakePeer()
                    s.markPeerCreating()
                    s.markPeerConnecting()
                    s.markPeerOpen('peer-alice')
                    s.addPeerConsumer(token)
                },
            },
            {
                name: 'disconnected sans backoff',
                apply: (s) => {
                    s.localPeer = fakePeer(null, { disconnected: true })
                    s.lastLocalPeerId = 'peer-alice'
                },
            },
            {
                name: 'disconnected avec backoff',
                apply: (s) => {
                    s.localPeer = fakePeer(null, { disconnected: true })
                    s.lastLocalPeerId = 'peer-alice'
                    s.peerReconnectTimer = 12345
                },
            },
            {
                name: 'detruit et encore prêt',
                apply: (s) => {
                    s.localPeer = fakePeer('peer-alice', { destroyed: true })
                    s.peerPhase = PEER_PHASES.READY
                    s.lastLocalPeerId = 'peer-alice'
                },
            },
            { name: 'prêt sans peer', apply: (s) => { s.peerPhase = PEER_PHASES.READY } },
            { name: 'id historique orphelin', apply: (s) => { s.lastLocalPeerId = 'peer-alice' } },
            {
                name: 'orphelin en sursis',
                apply: (s) => { s.localPeer = fakePeer(); s.peerDestroyTimer = 54321 },
            },
        ]

        CASES.forEach(({ name, apply }) => {
            it(`même verdict sur « ${name} »`, () => {
                // Un jeton partagé : `consumers` doit compter pareil des deux côtés.
                const token = {}
                const mockStore = createMockContext({ contextId: 'data-app' }).peerStore

                apply(store, token)
                apply(mockStore, token)

                expect(mockStore.peerIdentity()).toEqual(store.peerIdentity())
                expect(mockStore.peerStateViolations().map((v) => v.code))
                    .toEqual(store.peerStateViolations().map((v) => v.code))
            })
        })
    })

    // ── L'audit ne doit JAMAIS être conditionné à l'environnement ─────────────────
    //
    // Balai, pas vérification de comportement — même famille que `noInlinedTurnSecret.test.js`,
    // et pour la même raison : la panne est INVISIBLE. Aucun test de comportement ne peut la
    // voir, puisque `import.meta.env.DEV` vaut `true` sous Vitest.
    //
    // Ce que Vite fait réellement : il ne LIT pas `import.meta.env.DEV`, il le REMPLACE par sa
    // valeur en texte au build. Un `if (!import.meta.env.DEV) return []` devient donc
    // `if (true) return []`, et le minifieur supprime tout ce qui suit — la chaîne
    // `[WebRTC2][invariant]` disparaissait entièrement de `public/build/assets/js/*.js`
    // (vérifié). L'unique instrument d'observation de l'état du Peer était éteint dans le SEUL
    // environnement où le bug se reproduit.

    describe('l\'audit survit au build de production', () => {
        const SOURCE_ACTIONS = import.meta.glob('../../../stores/peers2/actions.js', {
            query: '?raw', import: 'default', eager: true,
        })

        /** Le corps de `auditPeerState`, commentaires retirés — un docblock ne compile pas. */
        const corpsDeLAudit = () => {
            const source = Object.values(SOURCE_ACTIONS)[0]
            expect(source, 'source de stores/peers2/actions.js introuvable').toBeTruthy()

            const sansCommentaires = source
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '')

            const debut = sansCommentaires.indexOf('auditPeerState(')
            expect(debut, '`auditPeerState` a été renommée — mettre ce balai à jour').toBeGreaterThan(-1)

            // Jusqu'à l'action suivante : suffisant, et sans dépendre d'un compteur d'accolades.
            const fin = sansCommentaires.indexOf('\n    },', debut)
            return sansCommentaires.slice(debut, fin === -1 ? undefined : fin)
        }

        it('n\'est gardé par aucun drapeau d\'environnement', () => {
            const corps = corpsDeLAudit()

            expect(corps).not.toMatch(/import\.meta\.env\.(DEV|PROD|MODE)/)
            expect(corps).not.toMatch(/process\.env\.NODE_ENV/)
        })

        it('journalise bien, et sur `console.error`', () => {
            // Ceinture du balai ci-dessus : un audit non gardé mais qui ne dirait plus rien
            // serait aussi inutile, et le `grep` du bundle ne verrait pas la différence.
            expect(corpsDeLAudit()).toMatch(/console\.error\(/)
        })
    })

    describe('auditPeerState', () => {
        it('reste silencieux sur un état cohérent', () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => {})
            store.localPeer = fakePeer()
            store.markPeerCreating()
            store.markPeerConnecting()
            store.markPeerOpen('peer-alice')
            store.addPeerConsumer({})

            expect(store.auditPeerState('test')).toEqual([])
            expect(error).not.toHaveBeenCalled()
        })

        it('hurle sur `console.error` en nommant la transition', () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => {})
            store.peerPhase = PEER_PHASES.READY

            const violations = store.auditPeerState('après \'open\' du Peer')

            expect(violations.map((v) => v.code)).toContain('pret-sans-peer')
            // La transition, et pas seulement l'état : sans elle, un état contradictoire ne
            // dit pas quel chemin l'a produit — c'est toute l'information utile.
            expect(error).toHaveBeenCalledWith(
                expect.stringContaining('après \'open\' du Peer'),
                expect.objectContaining({ identity: expect.objectContaining({ state: 'absent' }) })
            )
            // `console.error` à dessein : une contradiction d'invariant n'est pas une
            // information, et c'est le seul canal que le module réserve à l'anormal.
            expect(error).toHaveBeenCalledWith(
                expect.stringContaining('[WebRTC2][invariant]'),
                expect.anything()
            )
        })
    })
})
