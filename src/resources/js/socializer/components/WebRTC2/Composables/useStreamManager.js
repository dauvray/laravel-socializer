/**
 * 📺 useStreamManager (Stream Layer)
 *
 *  lifecycle des flux distants : réception, registre borné, players, départ
 *
 * 👉 gère :
 * - le registre des flux distants (`ctx.media.remoteStreamsMap`) : clé canonique
 *   `slug-type`, éviction TTL + FIFO pour rester borné
 * - la création des players DOM des flux distants
 * - la résolution du pair distant à partir des métadonnées d'une connexion
 *
 * 👉 utilise (par injection, jamais par import) :
 * - usePeerMedia (players), useCallManager (FSM d'appel + séquence de départ)
 *
 * 👉 ne connaît PAS :
 * - l'orchestrateur : aucune couche supérieure ne lui est injectée
 * - `ctx.callMachine` : toute décision d'état d'appel passe par `callManager`
 * - PeerJS : elle ne reçoit que des `conn` déjà ouvertes et leurs métadonnées
 * - la **séquence de départ d'un pair** : elle résout le pair concerné et délègue
 *   à `callManager.handleRemoteDeparture` (propriétaire unique, quel que soit le
 *   transport qui a annoncé le départ)
 *
 * 👉 rôle :
 * - branchement des callbacks `onStreamReceived` / `onConnectionClose`
 * - garder le registre de flux cohérent avec ce qui est réellement affiché
 * - traduire un event de transport (`conn` fermée) en fait métier (« tel pair part »)
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

    /**
     * Retire l'entrée d'un flux distant quand ses pistes se terminent réellement.
     *
     * Filet indispensable en mode `stream` : aucun player n'y est créé (cf. plus bas), donc
     * `usePeerMedia._bindStreamCleanup` ne tourne pas et le registre ne dépendait que des
     * événements de fermeture PeerJS — sinon de l'éviction TTL, qui ne s'exécute qu'à
     * l'arrivée d'un nouveau flux. Un flux mort sans `close` laissait donc une vignette
     * figée. C'est ce filet qui permet à `useCallManager._purgePeerStreams` de ne retirer
     * QUE le type qui s'est fermé, sans risque de fuite.
     *
     * Écouteurs `{ once: true }` et handler idempotent : pas de désinscription à tenir
     * (un écouteur résiduel sur une piste déjà morte est sans effet), et l'entrée n'est
     * supprimée que si elle porte toujours CE flux — elle a pu être remplacée entre-temps.
     */
    const _bindRemoteStreamCleanup = (stream, streamKey) => {
        // `getTracks` est vérifié séparément de `instanceof` : un flux peut satisfaire le
        // type sans exposer l'API (implémentations partielles, doublures de test).
        if (!(stream instanceof MediaStream) || typeof stream.getTracks !== 'function') return

        const onDead = () => {
            const current = ctx.media.remoteStreamsMap.get(streamKey)
            if (!current || current.stream !== stream) return

            media.removeVideoElement(`remote-${current.remoteSlug}-${current.remoteType}`)
            ctx.media.remoteStreamsMap.delete(streamKey)
        }

        stream.getTracks().forEach((track) => {
            track.addEventListener('ended', onDead, { once: true })
            track.addEventListener('inactive', onDead, { once: true })
        })
    }

    const handleStreamReceived = async (stream, conn, metadata) => {
        const ready = await ctx.waitForMeReady()
        if (!ready) return

        const meta = metadata || conn?.metadata || {}
        const remoteSlug = _resolveRemoteSlug(meta)
        const remoteType = meta?.type || conn?.metadata?.type || 'visio'

        if (!remoteSlug) return

        // Clé canonique basée sur l'identité sémantique (slug + type), indépendante de l'objet conn :
        // garantit l'idempotence de la réception d'un même flux.
        // ⚠️ Les champs `remoteSlug` / `remoteType` stockés dans l'entrée sont la source de
        // vérité de l'identité du pair — la purge au départ (`useCallManager._purgePeerStreams`)
        // les lit plutôt que de re-parser la clé ou `metadata.from`.
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

        // Le registre doit suivre la vie réelle du flux, pas seulement les événements de
        // connexion : cf. _bindRemoteStreamCleanup.
        _bindRemoteStreamCleanup(stream, streamKey)

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

    /**
     * Déclencheur 2 : la connexion PeerJS d'un pair se ferme.
     *
     * Cette couche ne fait que ce qui lui appartient — **résoudre quel pair distant
     * porte cette connexion** à partir de ses métadonnées — puis délègue la séquence
     * de départ au CallManager, propriétaire unique de cette séquence (le déclencheur
     * 1 est le signal serveur `CloseConnectionToPeerID` → `remoteStopCall`).
     *
     * `waitForMeReady` reste ici : c'est la précondition de `_resolveRemoteSlug`
     * (besoin de `mySlug` pour distinguer le distant de soi-même), pas celle de la
     * séquence de départ.
     */
    const handleStreamRemoved = async (conn) => {
        const ready = await ctx.waitForMeReady()
        if (!ready) return

        const meta = conn?.metadata || {}
        const remoteSlug = _resolveRemoteSlug(meta)
        if (!remoteSlug) return

        await callManager.handleRemoteDeparture({
            userSlug: remoteSlug,
            type: meta?.type || 'visio',
            roomId: meta?.room || ctx.session.currentCallRoomId || null,
        })
    }

    return {
        handleStreamReceived,
        handleStreamRemoved,
    }
}
