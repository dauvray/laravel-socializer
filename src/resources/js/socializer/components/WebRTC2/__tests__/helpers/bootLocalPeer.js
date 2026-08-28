/**
 * bootLocalPeer.js — Amener le Peer local jusqu'à `'open'`, sans jamais attendre l'init
 *
 * Le motif que ce helper porte est le SEUL démarrage fidèle à la production, et il tient
 * en trois temps :
 *
 *   1. lancer la création **sans l'attendre** — `setLocalPeer()` est `async` et sort par
 *      un `return` nu sur ses chemins « rien à faire » (dont « peer déjà prêt ») : son
 *      `await` ne signifie donc pas « peer utilisable », et `useCallManager` ne l'attend
 *      pas non plus (cf. son commentaire de `startCallWithPeer`) ;
 *   2. attendre que l'instance EXISTE — depuis que `_doInit` commence par un aller-retour
 *      ICE, elle n'est pas construite dans le tick de l'appel ;
 *   3. émettre `'open'` — c'est CE seul événement qui rend le pair joignable : il pose
 *      la phase `ready`, publie l'identité locale et fait tourner l'audit d'invariants.
 *
 * ⚠️ **Un test qui saute le temps 3 laisse un peer qui n'est JAMAIS prêt.** Il verdit
 * quand même tant qu'il n'exerce que des chemins indifférents à l'identité locale — et le
 * jour où un garde consulte l'état du Peer, il rougit sans que rien n'ait changé chez lui.
 * C'était le cas de deux fichiers entiers (`incomingAuth`, `peerUnavailable`) avant ce
 * helper.
 *
 * ℹ️ **Mesuré, et ça vaut d'être su** : commenter l'émission ci-dessous fait rougir TOUS
 * les scénarios (qui passent par `createVirtualPeer`) et **aucun cas** de ces deux
 * fichiers-là. Leur admission entrante ne consulte effectivement pas l'identité locale :
 * l'`'open'` y est de la FIDÉLITÉ, pas un support d'assertion. Ne pas le retirer en
 * concluant « il ne sert à rien » — c'est ce qui remettrait le piège en place.
 *
 * ── Le piège de `vi.resetModules()` ──────────────────────────────────────────
 *
 * `_lastInstance` vit au niveau du MODULE du mock (contrairement au bus PeerJS, qui est
 * sur `globalThis` précisément pour survivre aux resets). Un appelant qui a fait
 * `vi.resetModules()` — c'est le cas de `createVirtualPeer` — travaille donc avec une
 * AUTRE copie du mock que celle importée statiquement ici : l'accesseur par défaut
 * ci-dessous ne verrait jamais son Peer, et l'attente expirerait sur « Peer non créé ».
 * D'où `getPeer` : ces appelants passent l'accesseur de LEUR copie.
 */
import { vi } from 'vitest'
import { markRaw } from 'vue'
import { PEER_PHASES } from '~socializer/stores/peers2/phases.js'
import { getLastPeerInstance } from '../__mocks__/peerjs.js'

/**
 * @param {Function} start Démarre la création — `() => transport.setLocalPeer()` ou
 *        `() => api.initializePeerConnection(callbacks)`. Sa valeur de retour n'est
 *        attendue qu'APRÈS l'`'open'`, jamais avant : c'est tout l'intérêt du motif.
 * @param {Object}   [options]
 * @param {string}   [options.peerId] Identité attribuée par le serveur PeerJS
 * @param {Function} [options.getPeer] Accesseur d'instance de la copie du mock à
 *        interroger (cf. l'en-tête : obligatoire après un `vi.resetModules()`)
 * @returns {Promise<Object>} L'instance de Peer, `'open'` déjà émis
 */
export async function bootLocalPeer(start, { peerId = 'peer-local', getPeer = getLastPeerInstance } = {}) {
    const started = start()

    await vi.waitFor(() => {
        const instance = getPeer()
        if (!instance) throw new Error(`Peer non créé (peerId attendu : ${peerId})`)
        return instance
    })

    const peer = getPeer()
    peer._triggerEvent('open', peerId)

    // Après l'`'open'`, et seulement pour ne pas laisser un rejet non traité : l'init
    // avale déjà ses erreurs, mais rien ne garantit qu'elle continuera de le faire.
    await started

    return peer
}

/**
 * Sème un Peer local PRÊT dans le store, sans passer par PeerJS.
 *
 * Pour les tests qui ne construisent aucun `Peer` (`createPeerContext.test.js`) et
 * semaient jusqu'ici le seul `lastLocalPeerId`. Ce semis-là décrivait un état que la
 * production ne produit jamais — un id historique sans peer — et il suffisait pourtant à
 * faire répondre « prêt » : c'est le défaut même que la FSM ferme, et un test ne doit pas
 * pouvoir l'exiger.
 *
 * Le faux peer est `markRaw` comme celui du transport : Vue ne doit pas proxifier
 * l'instance, sinon `peerIdentity()` compare des identités de proxy.
 *
 * @param {Object} peerStore Le store `peers2` (réel ou double)
 * @param {string} [peerId]  Identité attribuée
 * @returns {Object} le faux peer, mutable par le test (`destroyed`, `disconnected`)
 */
export function seedReadyPeer(peerStore, peerId = 'peer-local') {
    const peer = markRaw({ id: peerId, destroyed: false, disconnected: false })

    peerStore.localPeer = peer

    // Le CHEMIN complet, pas seulement l'arrivée. Par les transitions, jamais par une
    // affectation de `peerPhase` : elles sont le seul écrivain en production, et sauter
    // `creating`/`connecting` ferait journaliser au contrôle de transitions un enchaînement
    // que le code ne produit jamais — un semis ne doit pas inventer une histoire.
    //
    // Re-semis (un test qui remplace le peer du `beforeEach`) : on repasse par `absent`,
    // sinon le chemin commencerait par `ready → creating`, qu'aucun garde de production ne
    // laisse arriver. C'est la contrepartie d'un contrôle de transitions : il attrape aussi
    // les raccourcis du harnais.
    if (peerStore.peerPhase !== PEER_PHASES.ABSENT) {
        peerStore.markPeerAbsent('re-semis de test')
    }

    peerStore.markPeerCreating()
    peerStore.markPeerConnecting()
    peerStore.markPeerOpen(peerId)

    return peer
}

/**
 * L'inverse : plus aucun Peer local, et rien en vol.
 *
 * ⚠️ Nettoie AUSSI `lastLocalPeerId`, et c'est le point : l'id historique qui survit au
 * peer est la moitié silencieuse de la panne que la FSM ferme. Le laisser en place ferait
 * décrire au semis un état contradictoire (`id-historique-sans-peer`) alors que le test
 * ne veut dire qu'une chose — « je n'ai pas encore de peerId à publier ».
 *
 * @param {Object} peerStore Le store `peers2` (réel ou double)
 */
export function seedAbsentPeer(peerStore) {
    peerStore.localPeer = null
    peerStore.lastLocalPeerId = null
    peerStore.markPeerAbsent('semis de test')
}
