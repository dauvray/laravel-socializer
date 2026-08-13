/**
 * resolveRemoteSlug.js — identité du pair distant portée par une connexion PeerJS
 *
 * `conn.metadata` décrit la connexion du point de vue de celui qui l'a **ouverte** :
 *   - connexion entrante → `metadata.from` EST le pair distant. Ce champ est
 *     authentifié à l'admission par `_isAuthorizedIncomingPeer` (usePeerTransport) :
 *     membre de la room, ou mapping peerId vérifié, et anti-usurpation intra-room.
 *   - connexion sortante → `metadata.from` porte **mon** slug (cf.
 *     `_buildPeerConnectionConfig`) et `metadata.slug` la cible.
 *
 * D'où l'ordre de lecture : `from` s'il n'est pas moi, sinon `slug`. C'est la même
 * règle que celle documentée dans CONVENTIONS.md pour `remoteStreamsMap`.
 *
 * ⚠️ Ne JAMAIS lire l'identité d'un pair dans le payload applicatif d'un message
 * (`data.from`) : il est déclaratif et forgeable. La connexion, elle, est
 * authentifiée à l'admission — c'est la seule source d'identité fiable en réception.
 *
 * Note : `createPeerContext.handleClose` conserve une variante inline qui tolère une
 * identité locale absente ; volontairement non fusionnée ici, son cleanup doit rester
 * best-effort même sans `meStore`.
 *
 * @param {Object} metadata  `conn.metadata` (peut être absent)
 * @param {string|null} mySlug  identité locale (`meStore.getMe?.slug`)
 * @returns {string|null}  slug du distant, ou null s'il n'est pas distinguable de soi
 */
export function resolveRemoteSlug(metadata = {}, mySlug = null) {
    if (!metadata || !mySlug) return null

    if (metadata.from && metadata.from !== mySlug) {
        return metadata.from
    }

    if (metadata.slug && metadata.slug !== mySlug) {
        return metadata.slug
    }

    return null
}
