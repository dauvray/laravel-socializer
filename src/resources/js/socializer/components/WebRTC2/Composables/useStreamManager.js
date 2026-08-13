/**
 * 📺 useStreamManager (Stream Layer)
 *
 *  lifecycle des flux distants : réception, registre borné, players, départ
 *
 * 👉 gère :
 * - le registre des flux distants (`ctx.media.remoteStreamsMap`) : clé canonique
 *   `slug-type`, éviction TTL + FIFO pour rester borné
 * - la création/suppression des players DOM des flux distants
 * - la résolution du pair distant à partir des métadonnées d'une connexion
 * - le départ d'un pair dont la connexion se ferme
 *
 * 👉 utilise (par injection, jamais par import) :
 * - usePeerMedia (players), useCallManager (FSM d'appel + fermeture complète)
 *
 * 👉 ne connaît PAS :
 * - l'orchestrateur : aucune couche supérieure ne lui est injectée
 * - `ctx.callMachine` : toute décision d'état d'appel passe par `callManager`
 * - PeerJS : elle ne reçoit que des `conn` déjà ouvertes et leurs métadonnées
 *
 * 👉 rôle :
 * - branchement des callbacks `onStreamReceived` / `onConnectionClose`
 * - garder le registre de flux cohérent avec ce qui est réellement affiché
 *
 * ⚠️ Le pooling des instances Vue des players reste dans `usePeerMedia`
 * (`createVideoElement` monte une app par flux) — cf. TODOLIST.
 */

import { MAX_REMOTE_STREAMS, STREAM_STALE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

export function useStreamManager(ctx, { media, callManager }) {

    /**
     * Détermine le slug du pair distant à partir des métadonnées d'une connexion.
     * Retourne null si on ne peut pas distinguer le distant de soi-même.
     */
    const _resolveRemoteSlug = (metadata = {}) => {
         if (!metadata) return null

        const mySlug = ctx.meStore.getMe?.slug || null
        if (!mySlug) return null

        if (metadata.from && metadata.from !== mySlug) {
            return metadata.from
        }

        if (metadata.slug && metadata.slug !== mySlug) {
            return metadata.slug
        }

        return null
    }

    /**
     * Supprime les entrées stales (trop anciennes ou map trop grande) de remoteStreamsMap.
     * Appelé avant chaque ajout pour garantir une taille bornée.
     */
    const _cleanupStaleRemoteStreams = () => {
        const now = Date.now()

        // 1. Supprimer les entrées expirées (TTL)
        for (const [key, entry] of ctx.media.remoteStreamsMap.entries()) {
            if (now - (entry.createdAt ?? 0) > STREAM_STALE_MS) {
                media.removeVideoElement(`remote-${entry.remoteSlug}-${entry.remoteType}`)
                ctx.media.remoteStreamsMap.delete(key)
            }
        }

        // 2. Si encore trop grand, supprimer les plus anciens (FIFO)
        if (ctx.media.remoteStreamsMap.size >= MAX_REMOTE_STREAMS) {
            const overflow = ctx.media.remoteStreamsMap.size - MAX_REMOTE_STREAMS + 1
            let count = 0
            for (const [key, entry] of ctx.media.remoteStreamsMap.entries()) {
                if (count >= overflow) break
                media.removeVideoElement(`remote-${entry.remoteSlug}-${entry.remoteType}`)
                ctx.media.remoteStreamsMap.delete(key)
                count++
            }
        }
    }

    const handleStreamReceived = async (stream, conn, metadata) => {
        const ready = await ctx.waitForMeReady()
        if (!ready) return

        const meta = metadata || conn?.metadata || {}
        const remoteSlug = _resolveRemoteSlug(meta)
        const remoteType = meta?.type || conn?.metadata?.type || 'visio'

        if (!remoteSlug) return

        // Clé canonique basée sur l'identité sémantique (slug + type), indépendante de l'objet conn.
        // Garantit que handleStreamReceived et handleStreamRemoved utilisent la même clé.
        const streamKey = `${remoteSlug}-${remoteType}`

        if (ctx.media.remoteStreamsMap.has(streamKey)) {
            return
        }

        // Nettoyage préventif avant ajout (taille bornée + TTL)
        _cleanupStaleRemoteStreams()

        ctx.media.remoteStreamsMap.set(streamKey, {
            stream,
            metadata: meta,
            remoteSlug,
            remoteType,
            peerId: conn?.peer || null,
            createdAt: Date.now(),
        })

        // Côté récepteur : le stream entrant confirme que la connexion est établie.
        // La transition RECEIVING → CONNECTED est décidée par la couche appels.
        callManager.markCallConnected()

        // En mode 'stream', remoteStreamsMap est la source de vérité consommée par l'UI via remoteStreams.
        // On ne crée pas de player DOM injecté : c'est au composant (ex: StreamSimpleUI) de rendre les streams.
        // Pour les autres modes (visio, vocal…), on crée le player DOM comme d'habitude.
        if (stream instanceof MediaStream && ctx.session.currentType !== 'stream') {
            media.createVideoElement(
                {
                    videoId: `remote-${remoteSlug}-${remoteType}`,
                    type: remoteType,
                    source: 'remote',
                },
                stream
            )
        }
    }

    const handleStreamRemoved = async (conn, metadata) => {
        const ready = await ctx.waitForMeReady()
        if (!ready) return

        const meta = conn?.metadata || {}
        const remoteSlug = _resolveRemoteSlug(meta)
        const remoteType = meta?.type || 'visio'
        const roomId = meta?.room || ctx.session.currentCallRoomId || null

        if (!remoteSlug) return
        if (callManager.isRemoteClosing(remoteSlug)) return

        callManager.beginRemoteClosing(remoteSlug)

        try {
            const videoId = `remote-${remoteSlug}-${remoteType}`
            media.removeVideoElement(videoId)

            // Clé canonique identique à handleStreamReceived → suppression en passe unique.
            const streamKey = `${remoteSlug}-${remoteType}`
            ctx.media.remoteStreamsMap.delete(streamKey)

            ctx.removeCurrentCallUser(remoteSlug)

            ctx.eventBus.$emit('close-call', [{
                userSlug: remoteSlug,
                type: remoteType
            }])

            /*
                En mode stream (broadcast unidirectionnel), le cycle de vie du stream local est géré explicitement par l'utilisateur via stopStream().
                Un pair distant qui se déconnecte ne doit pas déclencher l'arrêt du broadcast local.
                La logique stopCallWithPeers full ne concerne que les modes d'appel bidirectionnels (visio, vocal)
                 où raccrocher côté distant justifie de tout fermer localement.
            */
            if (ctx.session.currentType !== 'stream' && ctx.session.currentCallUsers.length === 0) {
                await callManager.stopCallWithPeers([], false, {
                    mode: 'full',
                    roomId,
                })
            }

        } catch (error) {
            console.error('Error removing video element:', error)
        } finally {
            callManager.endRemoteClosing(remoteSlug)
        }
    }

    return {
        handleStreamReceived,
        handleStreamRemoved,
    }
}
