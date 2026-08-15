/**
 * isAuthorizedPeer.js — Garde d'autorisation SORTANTE : « ai-je le droit d'ouvrir une
 * connexion vers ce pair ? »
 *
 * Utilitaire pur : aucun état, aucun effet, importable depuis n'importe quelle couche.
 * Le pendant de `_isAuthorizedIncomingPeer` (usePeerTransport), qui garde le sens
 * entrant. Durcir l'entrant seul ne protège de rien : sur un appel média, c'est
 * l'ÉMETTEUR qui pousse son flux. Un tiers qui obtient de sa victime un
 * `connectToPeer(lui)` se fait livrer webcam, micro ou écran sans jamais avoir eu à
 * ouvrir quoi que ce soit.
 *
 * Deux chemins d'autorisation, exactement les deux mêmes que l'admission entrante :
 *
 *   (a) Présence — le pair est membre de la room courante du contexte
 *       (`connection.usersInRoom`, alimenté par le canal de présence Reverb). Cas
 *       diffusion, chat, salons.
 *   (b) Appel direct — le pair est inscrit dans `session.authorizedCallPeers`, registre
 *       dédié dont `useCallManager` est le seul écrivain : il marque à l'acceptation
 *       d'un appel et à l'ouverture de celui que j'ai moi-même demandé. C'est ce chemin
 *       qui autorise la visio 1-à-1 **hors room**, laquelle n'a aucune room commune.
 *
 * ⚠️ `session.currentCallUsers` n'est PAS un chemin d'autorisation, bien qu'il ait l'air
 * de décrire la même chose. C'est un état d'affichage (qui voir, qui raccrocher), muté
 * par l'UI et sans invariant à protéger : le réutiliser comme allowlist coupleraient
 * politique de sécurité et présentation, et une évolution d'UI deviendrait une faille.
 * `_isAuthorizedIncomingPeer` a rejeté cet usage pour cette raison exacte, et A1 a créé
 * `authorizedCallPeers` pour ne pas le refaire.
 *
 * `isValidSlug` vient de `validators.js` — pas de regex locale (convention « un seul
 * système » : le format d'un slug est défini une fois, dans `webrtc2.config.js`).
 */
import { isValidSlug } from './validators.js'

/**
 * @param {*}      userSlug  Slug du pair visé (provenance : payload de signalisation)
 * @param {Object} ctx       Contexte WebRTC2 (createPeerContext)
 * @returns {boolean}        true si une connexion sortante vers ce pair est autorisée
 */
export const isAuthorizedPeer = (userSlug, ctx) => {
    if (!isValidSlug(userSlug)) return false

    // Lecture défensive : `usersInRoom` peut être transitoirement absent d'un contexte
    // en cours de montage ou de teardown.
    const usersInRoom = Array.isArray(ctx?.connection?.usersInRoom)
        ? ctx.connection.usersInRoom
        : []

    if (usersInRoom.includes(userSlug)) return true

    return ctx?.isAuthorizedCallPeer?.(userSlug) === true
}
