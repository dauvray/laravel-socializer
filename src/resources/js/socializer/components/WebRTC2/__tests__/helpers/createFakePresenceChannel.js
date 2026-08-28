/**
 * createFakePresenceChannel.js — Le canal de présence Reverb, en mémoire
 *
 * Reproduit la seule partie de `useReverbPresence` dont WebRTC2 dépend : les **client
 * events** (whispers), et surtout la façon dont Reverb les attribue. C'est ce qui permet
 * d'exercer l'annonce de diffusion par whisper — le seul porteur qui ne passe ni par la
 * signalisation ni par un canal data, donc le seul qu'aucun autre harnais ne peut livrer.
 *
 * ── Les deux fidélités qui comptent ───────────────────────────────────────────
 *
 * 1. **L'émetteur ne reçoit pas son propre whisper.** `Protocols\Pusher\EventDispatcher`
 *    reçoit la connexion source et l'exclut de la diffusion. Sans cette exclusion, un
 *    diffuseur s'annoncerait à lui-même et `markAnnouncedStream` — qui refuse mon propre
 *    slug — masquerait l'erreur : le harnais serait faux sans qu'aucun test ne rougisse.
 *
 * 2. **`metadata.user_id` vient du serveur, jamais de la charge utile.** Sous
 *    `accept_client_events_from: 'members'`, `Protocols\Pusher\ClientEvent` REGÉNÈRE
 *    l'enveloppe (`event`, `channel`, `data`) et y pose le `user_id` de la connexion
 *    authentifiée ; pusher-js le rend au handler en **second argument**. Ce harnais fait
 *    donc pareil : l'identité vient de `subscribe()`, pas de ce que l'émetteur écrit.
 *
 * ⚠️ Ce que ce double NE simule pas, volontairement : le mode `'all'`, où Reverb
 * retransmet l'événement brut sans contrôle d'appartenance ni attribution. Le cas « pas
 * de `user_id` » se teste en appelant le handler directement (cf.
 * `useBroadcastPresence.test.js`) — le simuler ici demanderait de modéliser une
 * configuration serveur que le front ne peut de toute façon pas observer.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *     const channel = createFakePresenceChannel()
 *     const aliceReverb = channel.subscribe({ id: 1, slug: 'alice' })
 *     const alice = await createVirtualPeer({ slug: 'alice', reverb: aliceReverb, … })
 */
import { vi } from 'vitest'

export function createFakePresenceChannel() {
    /** Un abonné = un onglet. Plusieurs contextes d'un même onglet partagent le sien. */
    const subscribers = []

    /**
     * Abonne un participant et rend l'objet que `useReverbPresence` exposerait.
     *
     * @param {Object} member       { id, slug } — l'identité que le serveur connaît
     * @returns {Object} l'API consommée par WebRTC2 : whisper / listenForWhisper / stop
     */
    const subscribe = (member) => {
        /** event → Set<handler> : plusieurs contextes d'un onglet écoutent le même nom. */
        const handlers = new Map()

        const subscriber = { member, handlers }
        subscribers.push(subscriber)

        return {
            whisper: vi.fn((event, payload) => {
                for (const other of subscribers) {
                    // L'émetteur s'exclut lui-même — cf. fidélité n°1.
                    if (other === subscriber) continue

                    for (const handler of other.handlers.get(event) ?? []) {
                        // Deux arguments, comme pusher-js : la charge utile, puis les
                        // métadonnées que le SERVEUR a posées.
                        handler(payload, { user_id: member.id })
                    }
                }
                return true
            }),

            listenForWhisper: vi.fn((event, handler) => {
                if (!handlers.has(event)) handlers.set(event, new Set())
                handlers.get(event).add(handler)
            }),

            /**
             * Sans `handler`, retire tout — c'est le repli de `useReverbChannel`, et le
             * cas qu'un consommateur unique utilise (`useChatSimple`).
             */
            stopListeningForWhisper: vi.fn((event, handler = null) => {
                if (!handler) {
                    handlers.delete(event)
                    return
                }
                handlers.get(event)?.delete(handler)
            }),
        }
    }

    return {
        subscribe,

        /** Membres abonnés, dans la forme d'une liste de présence (`id` ET `slug`). */
        members() {
            return subscribers.map((subscriber) => ({ ...subscriber.member }))
        },

        destroy() {
            subscribers.length = 0
        },
    }
}
