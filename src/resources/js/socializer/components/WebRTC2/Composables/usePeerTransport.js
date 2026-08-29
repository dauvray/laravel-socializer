/**
 * 📡 usePeerTransport (DataChannel Layer)
 * 
 * abstraction du transport DATA (PeerJS data connections)
 * 
 * 👉 gère :
 * - communication via datachannel (send / receive)
 * - enregistrement des callbacks entrants
 *
 * 👉 ne gère PAS :
 * - audio / vidéo
 * - UI
 * - signaling
 *
 * 👉 rôle :
 * - abstraction du transport de données temps réel
 * - indépendant du media (réutilisable pour chat, events, etc.)
 * 
 */

import { Peer } from "peerjs"
import { markRaw, onUnmounted, watch } from 'vue'
import {
    MAX_RECONNECT_ATTEMPTS,
    ATTESTATION_MAX_RETRIES,
    ATTESTATION_REFRESH_MARGIN_MS,
    ATTESTATION_REFRESH_MAX_DELAY_MS,
    ATTESTATION_REFRESH_MIN_DELAY_MS,
    ATTESTATION_RETRY_MS,
    HUB_RATE_WINDOW_MS,
    HUB_MAX_MESSAGES_PER_WINDOW,
    HUB_MAX_BYTES_PER_WINDOW,
    ICE_REFRESH_MARGIN_MS,
    ICE_REFRESH_MAX_DELAY_MS,
    ICE_REFRESH_MAX_RETRIES,
    ICE_REFRESH_MIN_DELAY_MS,
    ICE_REFRESH_RETRY_MS,
    MAX_METADATA_BYTES,
    MAX_PAYLOAD_BYTES,
    PEER_DESTROY_DELAY_MS,
    PEER_OPEN_TIMEOUT_MS,
    RECONNECT_BASE_DELAY_MS,
    RECONNECT_MAX_DELAY_MS,
    SLUG_PATTERN,
    STREAM_WAIT_TIMEOUT_MS } from '../webrtc2.config.js'
import { getPayloadSizeBytes, isPayloadWithinLimit } from './utils/payloadSize.js'
import { sanitizeMetadataType } from './utils/sanitizeMetadata.js'
import { createRateLimiter } from './utils/createRateLimiter.js'
import { isAuthorizedPeer } from './utils/isAuthorizedPeer.js'
import { fetchIceServers } from './utils/fetchIceServers.js'
import {
    fetchPeerAttestation,
    verifyPeerAttestation as requestAttestationVerdict,
} from './utils/fetchPeerAttestation.js'

// -----------------------------------------------------------------------------
// ⚠️ L'état du Peer singleton (compteur de consommateurs, promesse d'init,
// tentatives de reconnexion, handles des deux timers) N'EST PAS ici : il vit dans
// `peerStore` (cf. stores/peers2/state.js, section « Runtime du Peer singleton »).
//
// Raison : le module ES et le store n'ont pas la même durée de vie. Un HMR recharge
// ce module — compteurs remis à zéro — mais pas le store, où le Peer est toujours
// vivant : la copie neuve ne voyait plus les consommateurs montés, le premier
// démontage faisait tomber le compte à 0 et détruisait un peer encore utilisé
// (`lastLocalPeerId` à null ⇒ `waitForMeReady` abandonne au bout de 15 s ⇒ un
// arrivant ne reçoit jamais le flux). Symétriquement, une init en vol n'était plus
// visible et une seconde instance Peer était créée, la première fuyant avec un
// peerId fantôme encore enregistré côté serveur PeerJS.
//
// Le REGISTRE DES CONTEXTES a rejoint le store pour cette raison exacte (cf.
// `contextRegistry` dans state.js) : les dispatchers du Peer sont des closures qui le
// consultent, il doit donc partager sa durée de vie. Quand il vivait ici, un HMR
// renouvelait le registre et conservait le Peer, qui devenait sourd à tous les contextes
// — « Aucun contexte trouvé », connexion entrante fermée, recovery sur un registre mort.
//
// Ce qui RESTE volontairement au niveau du module :
//   - `_hubRateLimiter` plus bas : fenêtre glissante du hub, dont l'arbitrage
//     (verbe `.reset()` plutôt qu'une migration Pinia) est acté dans la TODOLIST.
// -----------------------------------------------------------------------------

// ⚠️ `cause` n'est pas décoratif. Une destruction volontaire, un rechargement de page et une
// coupure réseau produisent la MÊME trace côté serveur PeerJS (une WebSocket qui se ferme), et
// côté client les messages ne se distinguaient pas non plus : il a fallu croiser les logs
// `nginx` (`GET /app`) avec l'horodatage des morts de peer pour trancher, à la main. Nommer la
// cause supprime ce détour.
function _schedulePeerDestroy(peerStore, cause = 'cause non précisée') {
    // Annule tout timer en cours (ne pas empiler des destructions)
    peerStore.clearPeerDestroyTimer()

    if (PEER_DESTROY_DELAY_MS <= 0) {
        _destroyPeerSingleton(peerStore, `${cause} (délai de grâce nul)`)
        return
    }

    console.info(
        `[WebRTC2] Destruction du Peer programmée dans ${PEER_DESTROY_DELAY_MS}ms — cause : ${cause}` +
        ` (annulable si un composant remonte avant)`
    )
    peerStore.peerDestroyTimer = setTimeout(() => {
        peerStore.peerDestroyTimer = null
        _destroyPeerSingleton(peerStore, `${cause} (délai de grâce écoulé)`)
    }, PEER_DESTROY_DELAY_MS)
}

function _destroyPeerSingleton(peerStore, cause = 'cause non précisée') {
    // Cas résiduel : _destroyPeerSingleton peut être appelé après un échec
    // d'initialisation (catch de peerInitPromise) où localPeer a déjà été remis à null.
    // Les consommateurs, eux, sont toujours montés — et `resetPeerState` ne les touche
    // plus (il ne l'aurait jamais dû : détruire un Peer ne démonte aucun composant).
    // C'est ce qui a rendu l'ancien `keepConsumerCount` inutile.
    if (!peerStore.localPeer) {
        // Rien à détruire ; le reset annule aussi le timer de reconnexion par précaution.
        peerStore.resetPeerState()
        console.info(`[WebRTC2] Destruction du Peer sans objet — peer déjà absent (cause : ${cause})`)
        return
    }

    // Relevé AVANT toute manipulation : `destroy()` appelle `disconnect()`, qui met `_id` à
    // `null` (peerjs 1.5.4, `dist/bundler.mjs:1809`). Le lire après, c'est journaliser « sans
    // id » à chaque destruction — et perdre le seul moyen de recouper avec les logs du serveur
    // PeerJS, qui n'indexe QUE par peerId.
    const destroyedId = peerStore.peerIdentity().id

    // ⚠️ AVANT `destroy()`, et ce n'est pas de la précaution : vérifié dans peerjs 1.5.4
    // (`dist/bundler.mjs`), `destroy()` ne retire QUE les listeners de son socket interne
    // (`socket.removeAllListeners()`, l.1789) — les nôtres, posés sur le `Peer`, survivent.
    // Et il appelle `disconnect()`, qui **émet `disconnected`** (l.1810) alors que le drapeau
    // `_destroyed` n'est posé qu'ensuite (l.1781) : le garde `localPeer.destroyed` du handler
    // de reconnexion ne voyait donc rien, et une destruction volontaire était traitée comme
    // une coupure réseau — tentative consommée, faux « tentative n/8 », faux « abandon » au
    // plafond, et surtout `peerReconnectTimer` ÉCRASÉ : un backoff déjà en vol devenait un
    // timer orphelin que le `resetPeerState` ci-dessous ne pouvait plus annuler.
    peerStore.detachPeerListeners()

    try {
        if (!peerStore.localPeer.destroyed) {
            peerStore.localPeer.destroy()
        }
    } catch (e) {
        console.warn('[WebRTC2] Erreur lors de la destruction du Peer singleton :', e)
    }
    peerStore.resetPeerState()
    console.info(`[WebRTC2] Peer singleton détruit (${destroyedId ?? 'sans id'}) — cause : ${cause}`)
    peerStore.auditPeerState('après destruction du Peer')
}

// ─── Rafraîchissement du credential TURN ─────────────────────────────────────
//
// LE PROBLÈME, mesuré en livrant les credentials éphémères. La configuration ICE n'est récupérée
// qu'UNE FOIS par cycle de vie du `Peer` (l'`await fetchIceServers` de `_doInit`), et le `Peer` est
// un singleton d'onglet que rien ne détruit tant que la coquille SPA vit : contexte permanent
// `data-app` monté au tick 0, `PEER_DESTROY_DELAY_MS` armé seulement au départ du DERNIER
// consommateur, et `peer.reconnect()` qui réutilise la même instance donc le même `_options.config`.
// Passé le TTL du credential, l'appel en cours tient — coturn a déjà sa clé de session — mais TOUTE
// NOUVELLE ALLOCATION échoue : nouvel appel, ICE restart, nouveau flux. Symptôme : « la visio ne
// passe plus, un F5 la répare ».
//
// POURQUOI C'EST PETIT. PeerJS fait `new RTCPeerConnection(this.connection.provider.options.config)`
// à CHAQUE connexion (peerjs 1.5.4, `dist/bundler.mjs`), et `options` est un getter vivant sur
// `_options`. Réécrire `peer.options.config` suffit donc pour toutes les connexions futures : pas de
// `setConfiguration()`, pas de chirurgie sur les connexions ouvertes, pas de `Peer` recréé.
// ⚠️ C'est un interne NON CONTRACTUEL de PeerJS. Un renommage amont rendrait le rafraîchissement
// muet ; `peerjsMockFidelity.descriptors.test.js` casse ce jour-là au lieu de le laisser passer.
//
// POURQUOI UN MINUTEUR ET NON UN RAFRAÎCHISSEMENT PARESSEUX avant chaque `connectToPeer` : ce
// dernier est SYNCHRONE et porte un verrou anti-TOCTOU. Y insérer un `await` créerait un état
// intermédiaire observable, et TOUT CE QUI LIT CET ÉTAT devrait être réexaminé, pas seulement ce
// qui l'écrit — c'est exactement ce qu'a coûté le passage de la configuration ICE en HTTP (un
// `localPeer` nul alors que `peerInitPromise` était posée, dans lequel le timer de destruction
// différée faisait naître un `Peer` orphelin). Le seul `await` de ce mécanisme vit donc dans le
// callback du minuteur, sur aucun chemin d'appel.

/**
 * Arme une échéance de rafraîchissement, en millisecondes réelles.
 *
 * Séparée de `_scheduleIceRefresh` parce que les deux appelants n'ont pas la même donnée en main :
 * l'un connaît un TTL et veut la marge appliquée, l'autre (la reprise sur échec) connaît le délai
 * qu'il veut. Faire passer le second par le premier l'obligerait à fabriquer un faux TTL pour que
 * l'arithmétique de la marge retombe sur son délai — un calcul à rebours que personne ne relit
 * juste.
 *
 * @param {Object} peerStore
 * @param {Object} ctx        Le contexte dont l'`AjaxService` a servi le fetch initial
 * @param {Object} peer       L'instance visée — capturée, jamais relue depuis le store
 * @param {number} delayMs
 */
function _armIceRefresh(peerStore, ctx, peer, delayMs) {
    // Jamais empiler deux échéances sur le même Peer (même parti pris que `_schedulePeerDestroy`).
    peerStore.clearIceRefreshTimer()

    peerStore.peerIceRefreshTimer = setTimeout(() => {
        // Nullé EN ENTRANT, comme `_schedulePeerDestroy` : le handle d'un minuteur déjà consommé
        // ferait croire à `clearIceRefreshTimer` qu'une échéance est encore en vol.
        peerStore.peerIceRefreshTimer = null
        // `void` explicite : le callback d'un `setTimeout` ne peut pas être attendu, et
        // `_refreshIceConfig` ne rejette jamais (cf. son contrat).
        void _refreshIceConfig(peerStore, ctx, peer)
    }, delayMs)
}

/**
 * Arme le prochain rafraîchissement à partir de la durée de vie annoncée par le serveur.
 *
 * @param {Object}      peerStore
 * @param {Object}      ctx
 * @param {Object}      peer
 * @param {number|null} ttlMs  `null` ⇒ rien à rafraîchir : aucun minuteur n'est armé
 */
function _scheduleIceRefresh(peerStore, ctx, peer, ttlMs) {
    // Invité, mode statique, ou repli STUN : il n'y a pas de credential périssable, donc rien à
    // rafraîchir et AUCUN minuteur — le comportement d'avant ce mécanisme, à l'identique.
    //
    // ⚠️ Le `clear` doit quand même passer : c'est le chemin par lequel un `Peer` dont le
    // déploiement vient de repasser en mode statique cesse d'interroger la route.
    if (ttlMs === null) {
        peerStore.clearIceRefreshTimer()
        return
    }

    const delayMs = Math.min(
        Math.max(ttlMs - ICE_REFRESH_MARGIN_MS, ICE_REFRESH_MIN_DELAY_MS),
        ICE_REFRESH_MAX_DELAY_MS,
    )

    _armIceRefresh(peerStore, ctx, peer, delayMs)
}

/**
 * Récupère une configuration ICE fraîche et la pose sur le `Peer`, puis réarme.
 *
 * ⚠️ Appelée depuis un `setTimeout`, donc **rien ici ne doit pouvoir rejeter** : une exception y
 * serait une `unhandledRejection` que personne n'observe. Ce n'est pas obtenu par un `try/catch`
 * fourre-tout mais par deux appuis vérifiables — `fetchIceServers` ne jette jamais (contrat épinglé
 * par son propre fichier de test), et l'objet rendu par `options` est mutable (épinglé sur la VRAIE
 * lib par `peerjsMockFidelity.descriptors.test.js`). Si l'un des deux tombe, c'est ce test-là qui
 * doit rougir, pas ce chemin qui doit avaler l'erreur.
 *
 * @param {Object} peerStore
 * @param {Object} ctx
 * @param {Object} peer     L'instance visée à l'armement
 */
async function _refreshIceConfig(peerStore, ctx, peer) {
    // ⚠️ AUCUNE garde AVANT l'aller-retour, et c'est délibéré : elle serait INATTEIGNABLE. Toute
    // destruction de `Peer` passe par `resetPeerState`, qui annule ce minuteur — donc un minuteur
    // qui se réveille vise nécessairement le singleton courant. Un garde ici serait du code qu'aucun
    // test ne peut rougir, c'est-à-dire une rustine. La fenêtre réelle est plus bas, autour de
    // l'`await`.
    const { iceServers, credentialTtlMs } = await fetchIceServers(ctx.AjaxService)

    // Et APRÈS : c'est celle-ci qui compte. Un cycle destruction → nouvelle init a pu se produire
    // pendant l'aller-retour, et le `Peer` neuf a armé SON minuteur avec SA configuration. Écrire
    // ici viserait une instance périmée ; réarmer ici doublerait le minuteur du neuf. Donc sortie
    // sèche, sans réarmement.
    if (peerStore.localPeer !== peer || peer.destroyed) {
        console.info('[WebRTC2] Rafraîchissement de la configuration ICE abandonné : le Peer visé n\'est plus le singleton courant.')
        return
    }

    // ⚠️ NE RIEN ÉCRIRE quand le serveur n'annonce pas de credential périssable. `fetchIceServers`
    // rend le repli STUN seul quand la route répond mal : l'écrire remplacerait une configuration
    // TURN QUI MARCHE par une configuration sans relais — un rafraîchissement qui dégrade, soit le
    // contraire de ce qu'on installe ici. Le TTL absent est le seul signal disponible, et il couvre
    // aussi le cas légitime « le déployeur est passé en mode statique entre-temps ».
    if (credentialTtlMs === null) {
        const attempt = peerStore.incrementIceRefreshAttempts()

        if (attempt >= ICE_REFRESH_MAX_RETRIES) {
            console.warn(
                `[WebRTC2] Rafraîchissement du credential TURN abandonné après ${attempt} tentatives —` +
                ' la configuration en place est conservée. Un rechargement de la page la renouvellera.'
            )
            return
        }

        console.warn(
            `[WebRTC2] Configuration ICE sans credential périssable (tentative ${attempt}/${ICE_REFRESH_MAX_RETRIES}) —` +
            ` configuration en place conservée, nouvelle tentative dans ${ICE_REFRESH_RETRY_MS}ms.`
        )
        _armIceRefresh(peerStore, ctx, peer, ICE_REFRESH_RETRY_MS)
        return
    }

    // ⚠️ `peer.options`, PAS `peer._options` : `options` est le getter que PeerJS lit lui-même
    // (`provider.options.config`), donc le seul chemin dont la survie est vérifiable de l'extérieur.
    // Sous test de vérité parce qu'un renommage amont le rendrait `undefined`, et qu'une
    // `TypeError` dans un callback de minuteur ne se voit nulle part.
    if (!peer.options || typeof peer.options !== 'object') {
        console.warn('[WebRTC2] Rafraîchissement du credential TURN impossible : `peer.options` est absent (interne PeerJS renommé ?).')
        return
    }

    peer.options.config = { iceServers }
    peerStore.resetIceRefreshAttempts()

    console.info('[WebRTC2] Credential TURN rafraîchi — les connexions futures utiliseront la nouvelle configuration ICE.')

    _scheduleIceRefresh(peerStore, ctx, peer, credentialTtlMs)
}

// ─── Attestation du peerId local ─────────────────────────────────────────────────────────────
//
// Le serveur signe `{peerId, slug, exp}` — le slug étant celui d'`Auth::user()`, jamais un champ du
// corps —, et le porteur transporte l'attestation dans la `metadata` de chaque connexion sortante.
// C'est ce qui corrobore l'identité sur le chemin (a) de `_isAuthorizedIncomingPeer`, où
// `metadata.from` était jusqu'ici la seule identité disponible.
//
// ⚠️ **L'OBTENTION EST DANS `_doInit`, AVANT `new Peer`, et ce n'est pas une commodité.** Le peerId
// est choisi par NOUS (`crypto.randomUUID()`, cf. le commentaire du constructeur) : l'attestation
// peut donc être demandée en parallèle de la configuration ICE et être POSÉE avant que le `Peer`
// n'existe. Sans cela il resterait une fenêtre — le chemin « bail encore valide » de
// `useConnectionPool` (navigation SPA, cas majoritaire) se connecte dès que `waitForMeReady` rend la
// main, sans aucun POST intermédiaire, donc avant qu'une attestation demandée à l'`'open'` ne soit
// revenue. Ces connexions-là partiraient sans attestation, et seraient refusées sous `enforce` par
// un refus que rien ne rattrape.
//
// Ne reste ici que le RAFRAÎCHISSEMENT, dont la forme est celle du credential TURN — mais dont
// l'enjeu n'est pas le même : une configuration ICE périmée dégrade en STUN, une attestation
// périmée vaut `null` chez le vérificateur, donc un refus.

/**
 * Arme une échéance de rafraîchissement d'attestation, en millisecondes réelles.
 *
 * Séparée de `_scheduleAttestationRefresh` pour la même raison que son homologue ICE : la reprise
 * sur échec connaît le délai qu'elle veut, pas un TTL dont il faudrait déduire une marge à rebours.
 *
 * @param {Object} peerStore
 * @param {Object} ctx
 * @param {Object} peer     L'instance visée — capturée, jamais relue depuis le store
 * @param {string} peerId   L'identité à faire réattester — capturée pour la même raison
 * @param {number} delayMs
 */
function _armAttestationRefresh(peerStore, ctx, peer, peerId, delayMs) {
    peerStore.clearAttestationRefreshTimer()

    peerStore.peerAttestationRefreshTimer = setTimeout(() => {
        // Nullé EN ENTRANT, comme les deux autres minuteurs : le handle d'un minuteur déjà consommé
        // ferait croire à `clearAttestationRefreshTimer` qu'une échéance est encore en vol.
        peerStore.peerAttestationRefreshTimer = null
        void _refreshAttestation(peerStore, ctx, peer, peerId)
    }, delayMs)
}

/**
 * Arme le prochain rafraîchissement à partir de la durée de vie annoncée par le serveur.
 *
 * @param {number|null} ttlMs  `null` ⇒ rien à rafraîchir : aucun minuteur n'est armé
 */
function _scheduleAttestationRefresh(peerStore, ctx, peer, peerId, ttlMs) {
    // Mécanisme inactif côté serveur (aucun secret, aucune `APP_KEY`) : il n'y a rien à faire
    // expirer, donc aucun minuteur. Le `clear` doit quand même passer — c'est le chemin par lequel
    // un onglet dont le déploiement vient de désactiver le mécanisme cesse d'interroger la route.
    if (ttlMs === null) {
        peerStore.clearAttestationRefreshTimer()
        return
    }

    _armAttestationRefresh(peerStore, ctx, peer, peerId, Math.min(
        Math.max(ttlMs - ATTESTATION_REFRESH_MARGIN_MS, ATTESTATION_REFRESH_MIN_DELAY_MS),
        ATTESTATION_REFRESH_MAX_DELAY_MS,
    ))
}

/**
 * Redemande une attestation fraîche pour le peerId courant, puis réarme.
 *
 * ⚠️ Appelée depuis un `setTimeout`, donc **rien ici ne doit pouvoir rejeter** — même contrat, et
 * même appui vérifiable, que `_refreshIceConfig` : `fetchPeerAttestation` ne jette jamais (contrat
 * épinglé par son propre fichier de test). Si cet appui tombe, c'est ce test-là qui doit rougir,
 * pas ce chemin qui doit avaler l'erreur.
 */
async function _refreshAttestation(peerStore, ctx, peer, peerId) {
    const { attestation, ttlMs, enforce } = await fetchPeerAttestation(ctx.AjaxService, peerId)

    // APRÈS l'aller-retour, comme pour ICE, et c'est la garde qui compte : un cycle destruction →
    // nouvelle init a pu se produire pendant ce temps, et le `Peer` neuf a demandé SA propre
    // attestation. Écrire ici poserait, pour l'identité courante, une attestation signée pour une
    // identité disparue — donc un refus systématique chez tous les récepteurs, indistinguable
    // d'une usurpation. Sortie sèche, sans réarmement.
    if (peerStore.localPeer !== peer || peer.destroyed) {
        console.info('[WebRTC2] Rafraîchissement de l\'attestation abandonné : le Peer visé n\'est plus le singleton courant.')
        return
    }

    // ⚠️ NE RIEN ÉCRIRE quand le serveur n'a rien servi. Même raison qu'au credential TURN, et elle
    // mord plus fort ici : remplacer une attestation VALIDE par `null` sur une route qui répond mal
    // ferait refuser, sous `enforce`, un pair qui était admis la seconde d'avant. L'attestation en
    // place reste donc, et on retente.
    if (attestation === null) {
        const attempt = peerStore.incrementAttestationAttempts()

        if (attempt >= ATTESTATION_MAX_RETRIES) {
            console.warn(
                `[WebRTC2] Rafraîchissement de l'attestation abandonné après ${attempt} tentatives —` +
                ' l\'attestation en place est conservée jusqu\'à son échéance. Un rechargement de la page la renouvellera.'
            )
            return
        }

        console.warn(
            `[WebRTC2] Attestation non renouvelée (tentative ${attempt}/${ATTESTATION_MAX_RETRIES}) —` +
            ` nouvelle tentative dans ${ATTESTATION_RETRY_MS}ms.`
        )
        _armAttestationRefresh(peerStore, ctx, peer, peerId, ATTESTATION_RETRY_MS)
        return
    }

    peerStore.setLocalPeerAttestation(attestation, enforce)
    peerStore.resetAttestationAttempts()

    _scheduleAttestationRefresh(peerStore, ctx, peer, peerId, ttlMs)
}

/**
 * Le slug que le SERVEUR reconnaît à ce peerId, ou `undefined` quand il ne l'a pas dit.
 *
 * ⚠️ Les trois retours sont distincts et aucun n'est superflu :
 *   - une **chaîne** — le serveur a nommé le porteur ;
 *   - **`null`** — le serveur a tranché : cette attestation ne vaut rien (forgée, expirée, ou pour
 *     un autre peerId). C'est un refus, et il est mémoïsé ;
 *   - **`undefined`** — le serveur n'a pas répondu (route morte, délai dépassé). C'est une
 *     IGNORANCE, jamais un refus : le garde doit alors fail-open. Fermer sur une indisponibilité
 *     serveur transformerait un incident d'infra en coupure de visio non rattrapable — une
 *     MediaConnection refusée n'est notifiée à personne.
 *
 * Mémoïsé par peerId dans le store, refus compris : sans cela, un pair refusé qui insiste ferait
 * payer un aller-retour à chacune de ses tentatives, à la cadence qu'il choisit. Une ignorance,
 * elle, n'est jamais mémoïsée — c'est l'infra qu'on attend, pas un verdict.
 *
 * @returns {Promise<string|null|undefined>}
 */
async function _attestedSlugFor(conn, ctx) {
    const senderPeerId = conn?.peer ? String(conn.peer) : null

    if (!senderPeerId) { return undefined }

    const known = ctx?.peerStore?.getAttestedPeer?.(senderPeerId)
    if (known) { return known.slug }

    const attestation = conn?.metadata?.attestation

    // Rien de présenté : c'est un REFUS (le serveur n'aurait rien à vérifier), et il ne coûte
    // aucun aller-retour.
    //
    // ⚠️ Et il n'est PAS mémoïsé, à la différence d'un refus rendu par le serveur. Le même peerId
    // peut très bien présenter une attestation à la connexion suivante : l'obtention a lieu avant
    // `new Peer`, mais elle a pu échouer et être rattrapée par une reprise
    // (`ATTESTATION_RETRY_MS`) sur la MÊME identité. Mémoïser ici condamnerait ce pair pour toute
    // la durée du cache, alors qu'il vient précisément de se mettre en règle.
    if (typeof attestation !== 'string' || attestation === '') { return null }

    const { slug, answered } = await requestAttestationVerdict(ctx?.AjaxService, attestation, senderPeerId)

    if (!answered) { return undefined }

    // L'échéance du verdict est celle de l'attestation qui l'a produit — que le client ne lit pas
    // (la charge est signée, pas chiffrée, mais la décoder ici dupliquerait le format à un endroit
    // où personne ne le vérifie). On retient donc le verdict pour la durée d'un rafraîchissement :
    // au pire une identité reste connue un peu au-delà de son attestation, ce qui ne peut que
    // RETARDER un refus, jamais en produire un.
    ctx.peerStore.noteAttestedPeer(senderPeerId, slug, Date.now() + ATTESTATION_REFRESH_MARGIN_MS)

    return slug
}

// ⚠️ PAS de hook `import.meta.hot` ici, et c'est un choix documenté.
//
// Une version précédente détruisait le Peer singleton dans un `hot.dispose()`, pour
// compenser le fait que le registre des contextes ne survivait pas au rechargement du
// module alors que le Peer, lui, survivait. C'était un contournement, et il coûtait cher :
// seul chemin capable de détruire un Peer SANS le délai de grâce de
// `PEER_DESTROY_DELAY_MS`, il tuait le Peer à chaque modification de code — et comme
// `public/hot` existe dès qu'on sert depuis le dev server, le bloc réputé « inerte en
// production » était bel et bien actif.
//
// La cause est traitée à la racine : le registre vit dans le store (cf. state.js), donc un
// module rechargé retrouve les contextes du Peer survivant. Il n'y a plus rien à disposer.

// ─── Rate limiting hub (topologie star) ─────────────────────────────────────
// Fenêtre glissante par expéditeur, clé = senderIdentity (peerId PeerJS entrant
// RÉEL, jamais `envelope.from` auto-déclaré — cf. faille [HAUTE] de SECURITY_AUDIT).
// Partagé entre contextes car le hub est unique.
const _hubRateLimiter = createRateLimiter({
    windowMs: HUB_RATE_WINDOW_MS,
    max: HUB_MAX_MESSAGES_PER_WINDOW,
})

// Second plafond, MÊME CLÉ, même mécanique en mode pondéré : celui-ci compte les
// octets réellement retransmis (`payload × destinataires`) et non les messages.
// Deux instances plutôt qu'un plafond composite, parce que les deux fenêtres se
// vident indépendamment — et parce qu'un refus doit pouvoir dire lequel a mordu.
const _hubByteLimiter = createRateLimiter({
    windowMs: HUB_RATE_WINDOW_MS,
    max: HUB_MAX_BYTES_PER_WINDOW,
})

// Validation de slug côté hub : rejette les destinataires forgés avant retransmission
// star. SLUG_PATTERN est centralisé dans webrtc2.config.js (source de vérité partagée
// avec usePeerOrchestrator).
function _isValidSlug(value) {
    return typeof value === 'string' && SLUG_PATTERN.test(value)
}

/**
 * À quel slug l'identité PeerJS de cette connexion se résout-elle, si elle se résout ?
 *
 * TROIS sources, dans cet ordre, et la troisième est la seule autoritative :
 *   1. les membres connus de la room courante, par le mapping `slug → peerId` ;
 *   2. le mapping complet, si `remotePeers` est temporairement vide ;
 *   3. **l'attestation vérifiée par le serveur**, quand un verdict est déjà connu.
 *
 * ⚠️ La troisième est mise en DERNIER, et c'est délibéré : les deux premières sont synchrones et
 * gratuites, la troisième ne l'est que si le verdict est déjà en cache. Elle ne peut pas contredire
 * les deux autres sans que ce soit une usurpation — c'est justement ce que l'appelant en fait.
 *
 * ⚠️ `getAttestedPeer` n'est PAS une allowlist : il dit qui est en face, jamais s'il a le droit
 * d'entrer. Le brancher sur une décision d'admission ferait d'un pair attesté un interlocuteur
 * autorisé — l'auto-inscription que `authorizedCallPeers` a fermée, par une autre porte.
 */
function _resolveSenderSlugFromIncomingConn(conn, ctx) {
    const senderPeerId = conn?.peer ? String(conn.peer) : null
    if (!senderPeerId) return null

    const remotePeers = Array.isArray(ctx?.connection?.remotePeers)
        ? ctx.connection.remotePeers
        : []

    // Priorité: ne considérer que les membres connus de la room courante.
    for (const slug of remotePeers) {
        const mappedPeerId = ctx?.peerStore?.getRemotePeerId?.(slug)
        if (mappedPeerId && String(mappedPeerId) === senderPeerId) {
            return slug
        }
    }

    // Fallback défensif: parcourt la map complète si remotePeers est temporairement vide.
    // ⚠️ Via le getter, jamais à la main : l'entrée du store est `{ peerId, learnedAt }`,
    // et une comparaison écrite ici sur la valeur brute rendrait `'[object Object]'` —
    // donc jamais d'égalité, et aucune erreur levée. Le getter est aveugle au bail à
    // dessein : cette résolution alimente l'anti-usurpation.
    const mapped = ctx?.peerStore?.getSlugByRemotePeerId?.(senderPeerId) ?? null
    if (mapped) return mapped

    // Le verdict du serveur, s'il est déjà connu. `getAttestedPeer` rend `undefined` quand il faut
    // (re)demander et `{ slug: null }` quand le serveur a refusé — les deux valent « rien à
    // opposer » ICI, la distinction appartenant à `_isAuthorizedIncomingPeer`, qui seul peut
    // attendre un aller-retour.
    return ctx?.peerStore?.getAttestedPeer?.(senderPeerId)?.slug ?? null
}

// ─── Authentification des connexions/appels entrants ─────────────────────────
// Faille [HAUTE]: localPeer.on('connection'|'call') acceptait toute connexion dont
// le peerId était connu, sans vérifier que l'émetteur est un membre autorisé de la
// room — un tiers connaissant un peerId pouvait ouvrir un datachannel ou déclencher
// un appel et recevoir le stream local.
//
// Règle d'admission (appliquée AVANT setUpConnectionListeners / call.answer):
//   1. `metadata.from` doit avoir un format de slug valide (_isValidSlug)
//   2. L'émetteur doit être autorisé via L'UN des deux chemins suivants :
//      (a) Chemin présence : `metadata.from` ∈ `ctx.connection.remotePeers` — cas
//          diffusion/chat dans une room de présence Reverb partagée.
//      (b) Chemin appel direct : `peerStore.getRemotePeerId(metadata.from)` existe
//          ET est égal à l'identité PeerJS réelle de la connexion (`conn.peer`).
//          Le mapping slug→peerId est exclusivement alimenté par la signalisation
//          backend `peer-access-permission` (acceptCallFromPeer côté récepteur,
//          openCallBetweenPeer côté initiateur), donc sa présence ET sa correspondance
//          tiennent lieu d'autorisation ET d'anti-usurpation en une seule condition.
//   3. Anti-usurpation, sur LES DEUX chemins — si l'identité PeerJS réelle de la
//      connexion est déjà résolue à un slug connu, ce slug doit être `metadata.from`,
//      sinon rejet. La résolution a TROIS sources (cf.
//      `_resolveSenderSlugFromIncomingConn`), dont la dernière est autoritative :
//      l'attestation signée par le serveur, que le pair transporte dans sa `metadata`.
//      C'est elle qui ferme le chemin (a) — un attaquant n'obtient jamais qu'une
//      attestation à SON nom, donc elle contredit dès qu'il en déclare un autre.
//      Cette règle n'est PAS une défense-en-profondeur : c'est le seul anti-usurpation
//      du chemin (a), qui n'exige rien d'autre qu'un slug déclaré présent dans
//      `remotePeers`.
//      Si l'identité n'est résolue par AUCUNE des trois, l'admission est dite NON
//      CORROBORÉE. Ce cas n'est PAS tranché ici — il demande un aller-retour, donc une
//      décision asynchrone : `_concludeIncoming` le porte, et `_settleAdmission` arbitre
//      entre trace et refus selon `attestationEnforce`. Ne jamais refuser ici sur
//      « non résolu » : sur le chemin présence le mapping du récepteur est
//      structurellement absent quand l'appel entrant arrive le premier (mesuré par
//      scenarios/incomingMappingInvariant.test.js), et ce refus fermerait toute
//      diffusion en room.
//
// Important : `ctx.session.currentCallUsers` n'est PAS consulté ici. C'est un état UI
// (qui voir/raccrocher) alimenté à partir de la même signalisation, mais réutiliser un
// état applicatif comme allowlist de sécurité couple politique et affichage et laisse
// passer une connexion entrante avant que le mapping peerId ne soit prêt.
//
// `options.quiet` — évalue sans rien journaliser. Réservé à `_admitIncoming`, qui
// interroge ce prédicat une première fois avant de savoir s'il peut conclure : un refus
// provisoire n'est pas un refus, et le journaliser doublerait la décision finale.
function _isAuthorizedIncomingPeer(metadata, conn, ctx, { quiet = false } = {}) {
    const declaredFrom = metadata?.from
    const warn = quiet ? () => {} : console.warn
    const debug = quiet ? () => {} : console.debug

    if (!_isValidSlug(declaredFrom)) {
        warn(
            '[WebRTC2] Connexion entrante refusée: `metadata.from` absent ou format de slug invalide',
            { declaredFrom, senderPeerId: conn?.peer }
        )
        return false
    }

    const remotePeers = Array.isArray(ctx?.connection?.remotePeers)
        ? ctx.connection.remotePeers
        : []
    const senderPeerId = conn?.peer ? String(conn.peer) : null

    const isRoomMember = remotePeers.includes(declaredFrom)

    // Chemin (b) — appel direct vérifié : exige le mapping signalé ET la correspondance
    // avec le peerId PeerJS réel. Les deux vérifications sont fusionnées : si l'une
    // manque, ce chemin échoue et seul (a) peut autoriser.
    const mappedPeerId = ctx?.peerStore?.getRemotePeerId?.(declaredFrom)
    const isVerifiedDirectCallPeer =
        !!mappedPeerId && !!senderPeerId && String(mappedPeerId) === senderPeerId

    if (!isRoomMember && !isVerifiedDirectCallPeer) {
        warn(
            "[WebRTC2] Connexion entrante refusée: émetteur ni membre de la room ni interlocuteur autorisé (mapping peerId absent/non concordant)",
            { declaredFrom, senderPeerId, remotePeers, hasMappedPeerId: !!mappedPeerId }
        )
        return false
    }

    // Anti-usurpation — inconditionnelle : le peerId réel de la connexion ne doit être
    // résolu à AUCUN autre slug, quel que soit le chemin qui a admis. Le chemin (b)
    // vérifie déjà `mappedPeerId === senderPeerId` dans le sens slug → peerId ; la
    // résolution inverse ferme le cas où ce même peerId est aussi mappé à un autre slug.
    const resolvedSlug = _resolveSenderSlugFromIncomingConn(conn, ctx)
    if (resolvedSlug && resolvedSlug !== declaredFrom) {
        warn(
            '[WebRTC2] Connexion entrante refusée: usurpation détectée (peerId réel ≠ `from` déclaré)',
            { declaredFrom, resolvedSlug, senderPeerId }
        )
        return false
    }

    // Admission non corroborée : rien ne rattache ce peerId à `declaredFrom` — le slug
    // déclaré est la seule identité disponible.
    //
    // ⚠️ CE GARDE NE TRANCHE PAS CE CAS, et c'est délibéré : la corroboration passe par un
    // aller-retour d'attestation, donc par une décision asynchrone, et ce garde est
    // synchrone. `_concludeIncoming` la porte — c'est lui qui demande le verdict au serveur,
    // et lui qui refuse ou non selon `attestationEnforce`. Ici on ne fait que TRACER, et
    // cette trace reste ce qui mesure la surface du contrôle.
    if (!resolvedSlug) {
        debug(
            '[WebRTC2] Admission entrante non corroborée: peerId entrant résolu à aucun slug',
            { declaredFrom, senderPeerId, path: isRoomMember ? 'presence' : 'direct-call' }
        )
    }

    return true
}

/**
 * `_isAuthorizedIncomingPeer`, mais qui ne conclut jamais sur une ignorance.
 *
 * Le chemin (a) du garde lit `remotePeers` : tant que le contexte n'a pas synchronisé sa
 * présence, cette liste est vide et le garde refuse TOUT — y compris le `peer.call` qui
 * apporte son flux à un arrivant. Or ce refus-là est définitif dans les deux sens : la
 * MediaConnection refusée n'est notifiée à personne (PeerJS ne signale pas le `close()`
 * d'un appel jamais répondu) et l'émetteur, lui, voit un `peerConnection` en
 * `connecting` — donc `hasOpenConnection` vrai, donc son moteur de retry s'arrête. Le
 * récepteur reste sur un écran noir, sans une seule erreur console.
 *
 * On attend donc la première synchronisation de présence AVANT de refuser, jamais avant
 * d'admettre : le chemin (b) (appel direct au mapping concordant) n'a pas besoin de la
 * présence et n'est pas ralenti d'une microtâche — ce qui laisse la visio intacte, et
 * `data-app` (aucun canal de présence, que des appels directs) avec elle.
 *
 * **La même règle vaut désormais un cran plus loin, pour l'identité.** Un peerId qui ne se résout à
 * aucun slug ne dit pas « c'est un imposteur », il dit « je ne l'ai jamais vu » — et il y a
 * désormais quelqu'un à qui demander : le serveur, par l'attestation que le pair transporte dans sa
 * `metadata`. C'est ce qui ferme le chemin (a), et c'est `_concludeIncoming` qui le porte.
 *
 * ⚠️ Renvoie un **booléen** quand la décision est immédiate, une **promesse** dans tous les autres
 * cas. C'est délibéré : un `async` inconditionnel repousserait `setUpConnectionListeners` d'une
 * microtâche sur TOUS les chemins, alors que le dispatcher entrant est le point où l'ordre
 * d'exécution est le plus observable. L'appelant écrit donc
 * `if (typeof v !== 'boolean') v = await v`.
 *
 * ℹ️ Le chemin immédiat s'est RESSERRÉ avec la corroboration : il exige maintenant, en plus d'une
 * admission, une identité déjà résolue. Le chemin (b) le satisfait par construction — son mapping
 * concordant EST la résolution — donc la visio 1-à-1 et `data-app` n'ont rien perdu ; ce qui bascule
 * en asynchrone est le chemin (a), qui doit de toute façon interroger le serveur.
 *
 * @returns {boolean|Promise<boolean>}
 */
function _admitIncoming(metadata, conn, ctx) {
    // Y a-t-il quelque chose à DEMANDER au serveur ? Non dans deux cas : l'identité est déjà
    // résolue (chemin (b), ou verdict encore en cache), ou le pair ne présente aucune attestation
    // — il n'y aurait alors rien à vérifier.
    //
    // ⚠️ Ce second cas n'est pas un détail : c'est celui d'un déploiement dont le mécanisme est
    // INACTIF (aucun secret configuré), et le comportement doit y rester exactement celui d'avant
    // l'attestation, ordre d'exécution compris. Sans lui, tout le chemin (a) basculerait en
    // asynchrone pour aller ne rien demander à personne.
    const nothingToAsk = _resolveSenderSlugFromIncomingConn(conn, ctx) !== null
        || !_carriesAttestation(conn)

    // Et y a-t-il quelque chose à ATTENDRE ? Non si la présence est connue, ou si un chemin admet
    // sans elle. Silencieux : si le prédicat ne passe pas, la décision n'est pas encore prise et
    // la journaliser ici doublerait celle de `_concludeIncoming`.
    const nothingToAwait = ctx?.connection?.presenceSynced === true
        || _isAuthorizedIncomingPeer(metadata, conn, ctx, { quiet: true })

    if (nothingToAsk && nothingToAwait) {
        return _isAuthorizedIncomingPeer(metadata, conn, ctx)
            && _settleAdmission(metadata, conn, ctx, true)
    }

    return _concludeIncoming(metadata, conn, ctx)
}

/** Cette connexion porte-t-elle une attestation à faire vérifier ? */
function _carriesAttestation(conn) {
    return typeof conn?.metadata?.attestation === 'string' && conn.metadata.attestation !== ''
}

/**
 * La décision finale, une fois que le garde a ADMIS : l'identité est-elle corroborée, et sinon ?
 *
 * Partagée par le chemin synchrone et le chemin différé — une seule écriture de la politique, sinon
 * les deux divergeraient au premier ajustement.
 *
 * @param {boolean} verdictKnown  Le serveur a-t-il tranché ? `false` ⇒ il n'a pas répondu.
 * @returns {boolean}
 */
function _settleAdmission(metadata, conn, ctx, verdictKnown) {
    if (_resolveSenderSlugFromIncomingConn(conn, ctx) !== null) {
        return true
    }

    const declaredFrom = metadata?.from
    const senderPeerId = conn?.peer ? String(conn.peer) : null

    // ⚠️ FAIL-OPEN, même sous `enforce`, et ce n'est pas une timidité : refuser sur une
    // indisponibilité d'infra transformerait un incident serveur en coupure de visio non
    // rattrapable — et ce serait un levier offert, puisque rendre la route injoignable suffirait
    // alors à couper toutes les rooms. Un avertissement distinct, pour que la cause soit lisible.
    if (!verdictKnown) {
        console.warn(
            '[WebRTC2] Admission entrante NON CORROBORÉE et non vérifiable : le serveur d\'attestation'
            + ' n\'a pas répondu. Admise malgré tout — un refus ici ferait d\'une panne de route une'
            + ' coupure de visio non rattrapable.',
            { declaredFrom, senderPeerId }
        )
        return true
    }

    ctx?.peerStore?.noteUncorroboratedAdmission?.()

    if (ctx?.peerStore?.attestationEnforce === true) {
        console.warn(
            '[WebRTC2] Connexion entrante refusée: identité non corroborée (aucune attestation valable'
            + ' pour ce peerId, et `enforce` est actif)',
            { declaredFrom, senderPeerId }
        )
        return false
    }

    return true
}

/**
 * La décision d'admission quand elle demande d'attendre quelque chose — et elle seule journalise.
 *
 * Deux attentes, dans cet ordre, chacune sous sa propre condition :
 *
 *  1. **la présence**, quand elle est inconnue et qu'aucun autre chemin n'admet. C'est la règle
 *     « une liste vide n'est pas une réponse » : `remotePeers` vide ne dit pas « ce pair n'est pas
 *     membre », il dit « je ne sais pas encore qui est membre » ;
 *  2. **le verdict du serveur sur l'attestation**, quand l'identité PeerJS ne se résout à aucun
 *     slug. C'est la même règle d'un cran plus loin, et c'est ce qui ferme le chemin (a) : un
 *     peerId inconnu ne dit pas « c'est un imposteur », il dit « je ne l'ai jamais vu » — et
 *     désormais il y a quelqu'un à qui demander.
 *
 * ⚠️ TROIS issues à une non-corroboration, et les distinguer est tout l'intérêt :
 *   - le serveur a nommé QUELQU'UN D'AUTRE ⇒ refus, par l'anti-usurpation du garde lui-même ;
 *   - le serveur a tranché « rien à valoir » (attestation absente, forgée, expirée) ⇒ refus sous
 *     `enforce`, admission tracée sinon ;
 *   - le serveur n'a PAS répondu (route morte, délai dépassé) ⇒ **admission**, même sous
 *     `enforce`, avec un avertissement distinct. Fermer sur une indisponibilité d'infra
 *     transformerait un incident serveur en coupure de visio non rattrapable — et ce serait un
 *     levier offert : rendre la route injoignable suffirait à couper toutes les rooms.
 */
async function _concludeIncoming(metadata, conn, ctx) {
    // Présence inconnue ET rien qui admette sans elle : on attend. Jamais avant d'admettre — le
    // chemin (b) reste immédiat, et `data-app`, qui n'a aucun canal de présence, n'attend rien.
    if (!ctx?.connection?.presenceSynced
        && !_isAuthorizedIncomingPeer(metadata, conn, ctx, { quiet: true })) {
        await (ctx?.waitForPresenceSync?.() ?? Promise.resolve(false))
    }

    // Le verdict n'est demandé que si l'identité n'est pas DÉJÀ résolue : un pair connu du mapping
    // ne paie jamais d'aller-retour, et un verdict encore en cache non plus (`getAttestedPeer`).
    // `undefined` ⇒ le serveur n'a pas parlé ; `null` ⇒ il a refusé ; une chaîne ⇒ il a nommé.
    let verdictKnown = true

    if (_resolveSenderSlugFromIncomingConn(conn, ctx) === null) {
        verdictKnown = (await _attestedSlugFor(conn, ctx)) !== undefined
    }

    // Le garde relit la résolution, verdict compris : c'est LUI qui refuse une contradiction
    // (`resolvedSlug !== declaredFrom`), et il journalise sa décision.
    if (!_isAuthorizedIncomingPeer(metadata, conn, ctx)) {
        return false
    }

    return _settleAdmission(metadata, conn, ctx, verdictKnown)
}

// Le registre et ses deux gardes (last-write-wins à l'inscription, identité au retrait)
// vivent dans le store : ces deux fonctions ne sont plus que des points de passage, gardés
// sur la présence du store pour rester appelables depuis un `onUnmounted` tardif.
function registerContext(ctx) {
    ctx?.peerStore?.registerContext?.(ctx)
}

function unregisterContext(ctx) {
    ctx?.peerStore?.unregisterContext?.(ctx)
}

/**
 * Le contexte visé par une connexion entrante, d'après sa `metadata.callbackKey`.
 *
 * ⚠️ Le store est passé en argument : cette fonction est appelée depuis les dispatchers du
 * Peer, qui n'ont pas de `ctx` (ils servent TOUS les contextes de l'onglet) mais ont le
 * store dans leur closure.
 */
function resolveContextByMetadata(metadata, peerStore) {
    return peerStore?.getContextById?.(metadata?.callbackKey) ?? null
}

export function usePeerTransport(ctx) {

    // Indique si ce contexte a bien appelé setLocalPeer() et est donc comptabilisé
    // comme consommateur du Peer singleton. Évite un double-décrémentage si
    // onUnmounted() est appelé sans que setLocalPeer() ait jamais été invoqué.
    let _isRegisteredAsConsumer = false

    // Jeton de consommation propre à CETTE instance du composable. Un objet nu suffit :
    // seule son identité compte, et deux instances n'en partagent jamais un.
    const _consumerToken = {}

    // Filet de sécurité : dépollue le registre même si l'orchestrateur ne passe pas
    // par cleanupPeerConnection() (navigation abrupte, crash de composant, etc.).
    onUnmounted(() => {
        unregisterContext(ctx)
        if (_isRegisteredAsConsumer) {
            // ⚠️ `=== 0`, jamais `<= 0` : `removePeerConsumer` rend `null` quand le jeton
            // n'était pas inscrit (« rien à conclure »), et seul un vrai zéro veut dire
            // « le dernier consommateur vient de partir ». L'ancien `<= 0` sur un compteur
            // planché confondait les deux et pouvait ordonner la destruction d'un Peer
            // encore utilisé.
            if (ctx.peerStore.removePeerConsumer(_consumerToken) === 0) {
                _schedulePeerDestroy(ctx.peerStore, `dernier consommateur parti (${ctx.contextId})`)
            }
        }
    })

    const setLocalPeer = async () => {

        const peerStore = ctx.peerStore

        // Chaque contexte s'enregistre, même si le peer singleton existe déjà.
        registerContext(ctx)

        // Comptabiliser ce contexte comme consommateur du singleton (une seule fois).
        // Le peer ne sera physiquement détruit que quand TOUS les consommateurs
        // auront appelé onUnmounted(), évitant ainsi les crashes croisés.
        // Si un timer de destruction différée est en cours (PEER_DESTROY_DELAY_MS),
        // l'annuler : le peer existant est réutilisé sans recréation.
        if (!_isRegisteredAsConsumer) {
            _isRegisteredAsConsumer = true
            peerStore.addPeerConsumer(_consumerToken)
            if (peerStore.clearPeerDestroyTimer()) {
                console.info('[WebRTC2] Destruction du Peer annulée — nouveau consommateur enregistré')
            }
        }

        // Le peer local est déjà prêt: rien à recréer, mais le contexte est bien enregistré.
        if (peerStore.peerIdentity().state === 'ready') return

        // Init EN VOL — le cas de la race condition à deux composants montés dans le même
        // tick (`DataRoom` + `StreamRoom`, ou `data-app` + `stream-<room>` en production).
        // Le premier crée la promesse d'init, le second reçoit LA MÊME plutôt que de créer un
        // second Peer.
        //
        // ⚠️ AVANT le garde d'instance, et c'est ce qui rend la promesse honnête pour TOUS
        // les appelants, pas seulement pour le premier. Depuis que l'init attend l'`'open'`,
        // cette promesse couvre la fenêtre ENTIÈRE — récupération ICE, construction, puis
        // l'aller-retour d'ouverture. Dans l'ordre inverse, un second consommateur monté
        // pendant cette fenêtre sortait par l'instance avec un `undefined` immédiat alors que
        // le pair n'était pas joignable : exactement le mensonge que cet `await` supprime.
        if (peerStore.peerInitPromise) return peerStore.peerInitPromise

        // Peer vivant SANS init en vol — reconnexion en cours (phase `disconnected`, backoff
        // armé), ou init passée dont la promesse est retombée.
        //
        // ⚠️ Ce garde porte sur l'INSTANCE, et il reste indispensable : c'est le SEUL à
        // couvrir cette fenêtre-là, où la promesse est nulle depuis longtemps et où la phase
        // n'est pas `ready`. Sans lui, un consommateur qui monte pendant un backoff créait un
        // SECOND Peer : le premier restait enregistré côté serveur PeerJS (peerId fantôme),
        // débranché de ses listeners par `setPeerListenersDetach`, et hors d'atteinte de
        // `_destroyPeerSingleton` qui n'agit que sur `peerStore.localPeer`. Symptôme :
        // « A diffuse, B reste sur le spinner », avec un `Could not connect to peer <uuid>`
        // sur le peerId fantôme.
        if (peerStore.localPeer && !peerStore.localPeer.destroyed) return

        const _doInit = async () => {
            // ⚠️ LE SEUL `await` avant `new Peer`, et il est ICI — jamais en tête de
            // `setLocalPeer`. Tout ce qui précède (`registerContext`, `addPeerConsumer`,
            // `clearPeerDestroyTimer`, les trois gardes) doit rester SYNCHRONE : deux contextes
            // montés dans le même tick s'appuient dessus, et c'est `setLocalPeer` qui enregistre
            // le contexte au registre.
            //
            // ⚠️ AVANT l'`await` : c'est cette phase qui rend « pas de peer » LÉGITIME pendant
            // l'aller-retour ICE. Posée après, la fenêtre serait lue comme `absent` — donc comme
            // une contradiction par l'audit, et comme « rien en vol » par tout lecteur.
            peerStore.markPeerCreating()

            // ⚠️ L'id est choisi ICI, AVANT tout aller-retour, et c'est ce qui rend l'attestation
            // possible sans fenêtre : elle porte sur un peerId qu'on connaît déjà. Le raisonnement
            // qui impose de le fournir au constructeur — plutôt que de laisser peerjs le résoudre —
            // est écrit en détail au `new Peer` ci-dessous ; il n'a pas changé.
            const peerId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                ? crypto.randomUUID()
                : `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

            // Les deux aller-retours EN PARALLÈLE : ils ne dépendent pas l'un de l'autre, et les
            // enchaîner ajouterait leurs délais au chemin critique de la création du `Peer`. Aucun
            // des deux ne jette (contrat épinglé par leurs fichiers de test respectifs), donc pas
            // de `Promise.allSettled` : `Promise.all` ne peut pas rejeter ici, et l'écrire ainsi
            // rend le contrat visible plutôt que présumé.
            //
            // ⚠️ L'attestation est demandée ICI et non à l'`'open'`, sans quoi il resterait une
            // fenêtre : le chemin « bail encore valide » de `useConnectionPool` (navigation SPA,
            // cas MAJORITAIRE) ouvre une connexion dès que `waitForMeReady` rend la main, donc
            // avant qu'une demande partie de l'`'open'` ne soit revenue. Ces connexions-là
            // partiraient sans attestation et seraient refusées sous `enforce`, par un refus que
            // rien ne rattrape.
            const [{ iceServers, credentialTtlMs }, attestation] = await Promise.all([
                // `fetchIceServers` rend toujours un tableau non vide (repli STUN seul, avec
                // timeout) : le Peer est créé même si `/get-ice-servers` est mort.
                fetchIceServers(ctx.AjaxService),
                // `fetchPeerAttestation` rend `attestation: null` sur tous ses replis ET quand le
                // mécanisme est inactif côté serveur : le Peer est créé de même, et l'admission
                // d'en face retombe sur ce qu'elle faisait avant ce mécanisme.
                fetchPeerAttestation(ctx.AjaxService, peerId),
            ])

            // ── Garde d'annulation ────────────────────────────────────────────────────────
            //
            // Pendant l'aller-retour ci-dessus, le store est dans un état qui n'existait pas
            // avant : `localPeer === null` ALORS QUE `peerInitPromise` est posée. Si le timer de
            // `_schedulePeerDestroy` se déclenche dans cette fenêtre, `_destroyPeerSingleton`
            // prend sa branche « peer déjà absent » → `resetPeerState()`, qui remet
            // `peerInitPromise` à `null`. Sans ce garde, le `new Peer` ci-dessous
            // naîtrait ORPHELIN : dans un store à 0 consommateur dont le timer a déjà été
            // consommé, donc hors d'atteinte de toute destruction future. C'est la famille du
            // « peerId fantôme » décrite plus haut, par un chemin neuf.
            //
            // Le prédicat discrimine exactement les trois évolutions possibles :
            //   • le dernier consommateur démonte (timer armé) → `peerInitPromise` INTACTE, on
            //     continue : le Peer sera créé, publié, et le timer le détruira proprement ;
            //   • le timer se déclenche → `peerInitPromise` nullée par le reset → on abandonne ;
            //   • une init plus récente a pris la main → identité différente → on abandonne, et
            //     le `.finally` ci-dessous ne nullera pas la promesse de la plus récente.
            // « plus aucun consommateur » serait un mauvais prédicat : c'est vrai dans le premier
            // cas, où il faut continuer.
            //
            // ⚠️ Ne JAMAIS déplacer ce garde avant l'`await` (`initPromise` est alors en zone
            // morte temporelle), ni insérer un `await` entre l'appel de `_doInit()` et le
            // `setPeerInitPromise(initPromise)` qui le suit : c'est le fait que ce segment soit
            // intégralement synchrone qui rend `initPromise` lisible ici.
            //
            // Sortie par un `return` nu, pas un `throw` : une annulation n'est pas un échec, et
            // le `.catch` en ferait un `console.error`.
            if (peerStore.peerInitPromise !== initPromise) {
                console.info('[WebRTC2] Init du Peer abandonnée : le singleton a été détruit, ou une init plus récente a pris la main, pendant la récupération de la configuration ICE.')
                return
            }

            // ⚠️ L'id est fourni PAR NOUS, en 1er argument, et ce n'est pas cosmétique :
            // c'est ce qui supprime le peerId fantôme.
            //
            // Sans id, peerjs résout le sien par HTTP puis fait
            // `retrieveId().then(id => this._initialize(id))` — sans AUCUN garde
            // `destroyed` (bundler.mjs). Un `destroy()` survenu pendant cet aller-retour
            // n'empêche donc rien : `Socket.start()` ne refuse que si `!!this._socket ||
            // !this._disconnected`, or après un destroy précoce `_socket` est `undefined`
            // et `_disconnected` est `true` — les deux passent. Un VRAI WebSocket s'ouvre,
            // avec son heartbeat de 5 s, et enregistre côté serveur un peerId que le
            // `Peer` ne connaît plus : ses listeners ont été retirés. Le pair est
            // enregistré mais SOURD.
            //
            // Mesuré en production : 6 peers simultanés pour 2 navigateurs, dont trois
            // survivants de plus de 105 s alors que leurs pages étaient rechargées. Un
            // `peer.call()` vers un tel id réussit au niveau signalisation et l'offre part
            // dans le vide — « rien ne se passe », sans la moindre erreur console. C'est
            // la moitié SILENCIEUSE du symptôme « A diffuse, B arrive, rien ».
            //
            // En fournissant l'id, `_initialize` est appelé synchroniquement depuis le
            // constructeur : il n'existe plus d'intervalle pendant lequel un destroy peut
            // passer inaperçu. Un UUID neuf à chaque instance, jamais un id stable : un id
            // réutilisé se heurterait au `ID-TAKEN` du serveur tant que la socket
            // précédente n'est pas fauchée (jusqu'à `alive_timeout`, 60 s), ce qui
            // remplacerait un peer sourd par un peer mort-né.
            //
            // ℹ️ Il est désormais tiré PLUS HAUT, avant les deux allers-retours : c'est ce qui
            // permet de faire attester l'identité en parallèle de la configuration ICE, donc de
            // n'avoir jamais de `Peer` vivant sans attestation. Rien d'autre n'a changé.
            const peer = markRaw(new Peer(peerId, {
                host: import.meta.env.VITE_PEERS_SERVER_HOST,
                port: import.meta.env.VITE_PEERS_SERVER_PORT,
                path: import.meta.env.VITE_PEERS_SERVER_PATH,
                key: import.meta.env.VITE_PEERS_SERVER_KEY,
                secure: true,
                config: { iceServers }
            }))
            peerStore.localPeer = peer
            // L'instance existe, son `'open'` n'est pas arrivé. Écrit dans le même segment
            // synchrone que l'affectation ci-dessus : les deux disent le même fait, et un
            // lecteur ne doit jamais pouvoir voir l'un sans l'autre.
            peerStore.markPeerConnecting()

            // ⚠️ DANS LE MÊME SEGMENT SYNCHRONE, et APRÈS la garde d'annulation : l'attestation
            // décrit l'identité de CE `Peer`. Posée avant la garde, elle écraserait celle d'une
            // init plus récente par une attestation signée pour un peerId abandonné — donc un
            // refus systématique chez tous les récepteurs. Posée plus tard, il existerait un
            // instant où un `Peer` est publié sans elle, et c'est exactement la fenêtre qu'on
            // ferme. `attestation.attestation` peut valoir `null` (repli, ou mécanisme inactif) :
            // le verbe du store le normalise, et l'admission d'en face retombe alors sur ce
            // qu'elle faisait avant ce mécanisme.
            peerStore.setLocalPeerAttestation(attestation.attestation, attestation.enforce)

            // ── L'init ne se termine plus ici : elle attend l'`'open'` ────────────
            //
            // « Init terminée » doit vouloir dire « pair joignable ». Créée ICI, avant les
            // `bind` : ce sont les handlers `'open'` et `'error'` qui la règlent, ils doivent
            // donc la trouver dans leur closure. Le minuteur, lui, n'est armé qu'à l'instant
            // de l'attendre — dernière ligne de `_doInit` —, jamais avant : entre l'armement
            // et l'`await` qui l'observe, il n'y a pas une instruction. Le précédent inverse
            // est `waitForMeReady`, qui armait le sien APRÈS l'effet surveillé et crachait un
            // faux avertissement quinze secondes plus tard sur un contexte sain.
            //
            // ⚠️ Le `catch` inerte n'est pas décoratif : si le branchement qui suit jette,
            // `_doInit` sort AVANT le `Promise.race` qui observe cette promesse, et un
            // `'error'` PeerJS arrivé ensuite la rejetterait sans personne pour l'entendre —
            // une `unhandledRejection`, que vitest fait échouer et que la console de
            // production affiche. Même hypothèse que le `setPeerListenersDetach` posé avant
            // les `bind`, dix lignes plus bas, où elle est déjà traitée comme réelle.
            let resolveOpen = null
            let rejectOpen = null
            const openPromise = new Promise((resolve, reject) => {
                resolveOpen = resolve
                rejectOpen = reject
            })
            openPromise.catch(() => {})

            // ── Branchement des listeners du Peer ─────────────────────────────────
            // `bind` est la SEULE porte d'entrée : il enregistre la paire (event, handler)
            // en même temps qu'il l'installe, donc un 6e listener ajouté ici est détaché
            // d'office — on ne peut plus oublier son `off`. Le détachement est stocké dans
            // `peerStore` (cf. state.js) : c'est un AUTRE contexte, voire une autre copie du
            // module après un HMR, qui détruira ce peer.
            //
            // Bindés sur la const `peer`, jamais sur `peerStore.localPeer` : la closure doit
            // viser l'instance qu'elle a réellement bindée. Relire le store au moment du
            // `off` détacherait les listeners du peer COURANT — après un cycle
            // destroy → init, ceux du nouveau. Les CORPS de handlers, eux, continuent
            // volontairement de lire `peerStore.localPeer` : leurs gardes signifient « le
            // store a-t-il encore un peer », pas « ce peer-ci ».
            const bound = []
            const bind = (event, handler) => {
                bound.push([event, handler])
                peer.on(event, handler)
            }

            // Enregistrée AVANT les `bind` : `bound` est capturé par référence, donc même une
            // exception au milieu du branchement laisse de quoi détacher ce qui a été posé.
            peerStore.setPeerListenersDetach(() => {
                while (bound.length > 0) {
                    const [event, handler] = bound.pop()
                    peer.off(event, handler)
                }
            })

            // a la création du Peer
            bind('open', id => {
                // Garde d'identité : n'écrire l'état du singleton que si CE peer est bien
                // celui que le store publie. Un peer supplanté (double init) ou détruit ne
                // doit pas déclarer la session prête ni publier son identité — c'est
                // exactement ce qui a produit la régression « A diffuse, B reste sur le
                // spinner » : `lastLocalPeerId` désignait un peer que plus personne ne
                // pouvait joindre. Ceinture du garde d'instance de `setLocalPeer`.
                if (peerStore.localPeer !== peer) return

                // Workaround for peer.reconnect deleting previous id
                //
                // ⚠️ `peer._id`, JAMAIS `peer.id` : `id` est un accesseur SANS setter
                // (peerjs 1.5.4, `get id()` dans `dist/bundler.mjs`), donc `peer.id = …`
                // lève une TypeError — un module ES est toujours en mode strict. Le champ
                // assignable est celui que l'accesseur lit. Cf. le garde du même nom dans
                // le handler 'disconnected', où la levée coûtait toute la reconnexion.
                //
                // ⚠️ AVANT la transition, et pas par élégance : `markPeerOpen` pose la phase
                // `ready`, et l'audit qui suit vérifie que le peer porte alors un id
                // utilisable (`pret-sans-id`). Restaurer l'instance après, c'est se faire
                // signaler une contradiction qu'on s'apprêtait à corriger.
                if (id === null) {
                    peer._id = peerStore.lastLocalPeerId
                }

                // Peer utilisable : connexion (re)établie avec le serveur PeerJS. La
                // transition porte les trois faits d'un `'open'` — la phase, l'identité
                // publiée, le compteur de reconnexion remis à zéro. Idempotente sur les
                // reconnexions.
                peerStore.markPeerOpen(id)

                peerStore.auditPeerState('après \'open\' du Peer')

                // L'init peut conclure : c'est CET événement, et lui seul, qui rend le pair
                // joignable. APRÈS la transition et l'audit — ce qui attend cette promesse
                // doit trouver un store qui dit déjà `ready`.
                //
                // ⚠️ SOUS la garde d'identité ci-dessus, et ce n'est pas un oubli : un peer
                // supplanté ne conclut rien. Ce chemin est de toute façon inatteignable —
                // toute supplantation passe par `setPeerListenersDetach` (qui exécute le
                // détachement précédent) ou par `detachPeerListeners`, donc ce handler est
                // débranché avant qu'un `'open'` puisse l'atteindre. Une résolution posée
                // au-dessus du garde serait du code qu'aucun test ne peut faire rougir ; le
                // filet de ce cas est le minuteur, qui porte sa propre garde d'identité.
                resolveOpen()
            })

            bind('error', (err) => {
                console.error('Erreur PeerJS :', err);

                // ── Recovery peer-unavailable ─────────────────────────────────────
                // PeerJS émet 'peer-unavailable' quand le peerId distant n'est pas (ou
                // plus) enregistré sur le serveur de signalisation.
                // Sans traitement, la connexion échouée reste dans le store avec
                // hasOpenConnection() qui retourne true (fallback peerConnection=null),
                // ce qui bloque le retry → le remote player n'apparaît jamais.
                //
                // Fix : on supprime la connexion échouée + on invalide le peerId stale
                //       + on notifie l'orchestrateur pour relancer le cycle complet.
                // ─────────────────────────────────────────────────────────────────
                if (err.type !== 'peer-unavailable') {
                    // L'init attend peut-être encore son `'open'` : cette erreur-là dit qu'il
                    // ne viendra pas. Le rejet est ICI, sous le prédicat qui filtre déjà la
                    // recovery, parce que `peer-unavailable` est le SEUL type qui ne parle pas
                    // de NOTRE pair — il nomme un peerId distant injoignable, et il tombe
                    // pendant toute la vie du Peer. Idempotent : après l'`'open'` la promesse
                    // est réglée et ceci est un no-op, une erreur tardive ne casse rien
                    // d'établi.
                    //
                    // ⚠️ Aucune liste d'`err.type` « fatals » à maintenir contre PeerJS, et
                    // aucune destruction à faire ici : quand il émet une erreur fatale, il
                    // avorte l'instance lui-même juste après — `_abort()` fait `emitError()`
                    // PUIS `if (!this._lastServerId) this.destroy()` (peerjs 1.5.4,
                    // `dist/bundler.mjs:1761-1764`), et `_lastServerId` n'est posé qu'à
                    // l'`OPEN` (`:1595`). Sa branche alternative, celle qui se contenterait
                    // d'un `disconnect()` en laissant la socket vivante, exige donc un
                    // `'open'` déjà reçu — donc une promesse déjà réglée. Il n'existe pas de
                    // fenêtre où ce rejet laisse un `Peer` vivant derrière lui.
                    rejectOpen(err)
                    return
                }

                // Format du message PeerJS : "Could not connect to peer <peerId>"
                const msgWords = typeof err.message === 'string' ? err.message.split(' ') : []
                const failedPeerId = msgWords.length > 0 ? msgWords[msgWords.length - 1] : null
                if (!failedPeerId) return

                // Recherche inverse peerId → userSlug, UNE FOIS, avant toute mutation.
                //
                // ⚠️ Elle vivait à l'intérieur de la boucle, et c'était une impasse : le
                // mapping slug → peerId est partagé par tout l'onglet, si bien que le
                // PREMIER contexte itéré l'invalidait et que tous les suivants sortaient
                // aussitôt sur `if (!targetSlug) return`. La recovery ne profitait donc
                // jamais qu'à un seul contexte — et en production c'est le mauvais :
                // `Notifications.vue` crée `data-app` au tick 0, il est donc premier dans
                // le registre (Map, ordre d'insertion), il absorbait la relance, et le
                // contexte de diffusion — le seul concerné — n'était jamais relancé.
                // Symptôme exact : « Could not connect to peer <uuid> » une seule fois,
                // puis plus rien, et un flux qui n'arrive jamais.
                //
                // ⚠️ La résolution passe par le getter, jamais par une comparaison écrite
                // ici : l'entrée du store est `{ peerId, learnedAt }`, et comparer la
                // valeur brute rendrait `'[object Object]'` — jamais d'égalité, aucune
                // erreur levée, et TOUTE cette recovery deviendrait inerte. Le getter est
                // aveugle au bail à dessein : un peerId mort est justement le cas où il
                // aurait expiré.
                let targetSlug = null
                for (const registeredCtx of peerStore.getRegisteredContexts()) {
                    targetSlug = registeredCtx.peerStore.getSlugByRemotePeerId?.(failedPeerId) ?? null
                    if (targetSlug) break
                }
                if (!targetSlug) return

                peerStore.getRegisteredContexts().forEach((registeredCtx) => {
                    const room = registeredCtx.session.currentCallRoomId || registeredCtx.session.currentRoom

                    // 1. Retirer les connexions échouées du store (libère le guard
                    //    hasOpenConnection, dont le fallback considère « ouverte » une
                    //    MediaConnection sans peerConnection exploitable).
                    //    ⚠️ Balayer aussi 'screen' : un partage d'écran est stocké sous ce
                    //    type, jamais sous session.currentType — on ne le trouvait donc
                    //    jamais, et sa connexion morte bloquait le retry.
                    const types = new Set([registeredCtx.session.currentType, 'screen'])
                    types.forEach((type) => {
                        const conns = [...(registeredCtx.peerStore.getConnections?.[room]?.[targetSlug]?.[type] ?? [])]
                        conns
                            .filter(conn => conn?.peer === String(failedPeerId))
                            .forEach(conn => {
                                registeredCtx.peerStore.removePeerConnectionInstance(room, targetSlug, type, conn)
                            })
                    })

                    // 2. Invalider le peerId mort pour forcer une nouvelle demande de
                    //    signalisation.
                    //    ⚠️ Inconditionnel, et SANS exiger d'avoir retrouvé une connexion
                    //    stockée : `peer.call()` peut échouer avant l'enregistrement, et
                    //    l'ancien garde `failedConns.length === 0` abandonnait alors avant
                    //    toute invalidation. Le peerId restait « collant » et le pair
                    //    devenait définitivement injoignable (cf. invalidateRemotePeerId,
                    //    qui explique pourquoi removeRemotePeerId ne convient pas ici).
                    registeredCtx.peerStore.invalidateRemotePeerId(targetSlug)

                    // 3. Relancer le cycle — mais SEULEMENT dans les contextes qui ont
                    //    quelque chose à faire de ce pair.
                    //
                    // ⚠️ L'invalidation ci-dessus est globale, la relance ne l'est pas, et
                    // la dissymétrie est voulue : un peerId mort est un fait sur l'ONGLET
                    // distant (le store est partagé), tandis que « redemander son peerId »
                    // est une intention qui appartient à un contexte.
                    //
                    // Sans ce filtre, chaque contexte de l'onglet redemandait — y compris
                    // le `data-app` de Notifications.vue, qui n'a AUCUN canal de présence
                    // (il ne sert qu'aux appels directs) et ne peut donc être autorisé par
                    // personne en face. Résultat : des POST /ask-to-peer-id inutiles et un
                    // « demandeur non autorisé » parfaitement légitime chez le
                    // destinataire, qui noyait les refus qui, eux, veulent dire quelque
                    // chose.
                    //
                    // Le prédicat est celui des deux autres sorties du contexte
                    // (utils/isAuthorizedPeer.js) : membre de la room OU interlocuteur
                    // d'appel autorisé. C'est ce second chemin qui préserve la recovery
                    // d'une visio 1-à-1, laquelle n'a précisément aucune room commune.
                    if (!isAuthorizedPeer(targetSlug, registeredCtx)) return

                    // usePeerOrchestrator observe ce signal via watch() → pas de couplage par mutation.
                    if (registeredCtx.peerUnavailableSignal) {
                        registeredCtx.peerUnavailableSignal.value = targetSlug
                    }
                })
            })

            bind('disconnected', () => {
                // Guard : ne reconnecter que si CE peer est encore celui du store, et qu'il
                // n'est pas détruit. La comparaison d'identité (plutôt qu'un simple test de
                // nullité) évite qu'un peer supplanté relance un backoff pour le compte du
                // peer courant, en écrasant au passage son handle de timer.
                if (peerStore.localPeer !== peer || peer.destroyed) return

                // Le peer n'est plus utilisable : le dire. Rien ne le disait hors destruction
                // complète, si bien qu'un peer déconnecté continuait de se déclarer « prêt » —
                // `setLocalPeer()` sortait alors par son premier garde, et `waitForMeReady()`
                // (qui lisait `lastLocalPeerId`, un fait HISTORIQUE) répondait oui. Pendant ce
                // temps l'identité COURANTE est nulle, car `Peer.disconnect()` met `_id` à
                // null : chaque publication du peerId local sortait donc en warn — l'onglet ne
                // répondait plus à aucune demande de peerId, sans le moindre signe visible.
                // Ramenée à `ready` par le handler 'open' dès que la reconnexion aboutit.
                peerStore.markPeerDisconnected()

                // Guard auto-reconnect infinie : abandon après MAX_RECONNECT_ATTEMPTS
                if (peerStore.peerReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.error(
                        `[WebRTC2] PeerJS: serveur injoignable après ${MAX_RECONNECT_ATTEMPTS} tentatives — abandon.`
                    )
                    // ⚠️ L'audit est APRÈS le verdict, jamais avant : c'est l'existence d'un
                    // backoff en vol qui distingue une coupure transitoire (l'id historique
                    // est alors exactement ce dont `reconnect()` repart) d'un état TERMINAL.
                    // Sur ce chemin-ci, aucune reconnexion ne viendra : `lastLocalPeerId`
                    // continuera de faire répondre « prêt » à `waitForMeReady` sur un peer
                    // définitivement mort — la panne silencieuse du module.
                    peerStore.auditPeerState('après abandon de la reconnexion du Peer')
                    return
                }

                const attempt = peerStore.incrementReconnectAttempts()

                // Backoff exponentiel : BASE · BASE*2 · BASE*4 … plafonné à MAX_DELAY
                const delayMs = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1), RECONNECT_MAX_DELAY_MS)

                console.warn(
                    `[WebRTC2] PeerJS déconnecté — tentative ${attempt}/${MAX_RECONNECT_ATTEMPTS} dans ${delayMs}ms`
                )

                // ⚠️ Annuler AVANT d'armer : l'assignation ci-dessous ne faisait qu'écraser le
                // handle, elle n'annulait pas le timer. Deux `disconnected` sans `open` entre
                // les deux laissaient donc un backoff orphelin — plus aucune référence pour
                // l'annuler, et un `reconnect()` en trop à son échéance.
                peerStore.clearReconnectTimer()

                peerStore.peerReconnectTimer = setTimeout(() => {
                    // Le handle ne mène plus nulle part : le remettre à null évite qu'un
                    // `clearReconnectTimer` ultérieur porte sur un timer déjà consommé et
                    // que le champ prétende qu'un backoff est en vol.
                    peerStore.peerReconnectTimer = null
                    if (peerStore.localPeer !== peer || peer.destroyed) return

                    // ⚠️ `reconnect()` n'est légal QUE sur un peer déconnecté : le vrai client
                    // LÈVE sinon (« cannot reconnect because it is not disconnected from the
                    // server », peerjs 1.5.4, `dist/bundler.mjs:1827`). Rien ne garantissait
                    // cette précondition à l'échéance du timer — et la levée serait une Error
                    // non rattrapée à l'intérieur d'un `setTimeout`, donc invisible autrement
                    // que par une entrée `unhandled` dans la console.
                    if (!peer.disconnected) return
                    // Workaround for peer.reconnect deleting previous id.
                    //
                    // ⚠️ `_lastServerId` SEUL, et c'est vital : `reconnect()` repart de ce
                    // champ (`_initialize(this._lastServerId)`, qui réécrit `_id` lui-même),
                    // donc le restaurer suffit. L'assignation `peer.id = …` qui vivait ici
                    // levait une TypeError — `id` est un accesseur sans setter (peerjs 1.5.4)
                    // et un module ES est en mode strict — et cette levée sautait le
                    // `reconnect()` juste en dessous : AUCUNE reconnexion n'aboutissait
                    // jamais. Un peer déconnecté une fois (le serveur PeerJS fauche à
                    // `alive_timeout`, 60 s sans heartbeat) restait mort jusqu'au
                    // rechargement de l'onglet, sans rien dire ; en face, tout pair qui
                    // détenait son peerId ne récoltait plus qu'un
                    // « Could not connect to peer <uuid> » et l'arrivant ne voyait rien.
                    // Invisible en test : le mock portait `id` en propriété simple.
                    peer._lastServerId = peerStore.lastLocalPeerId
                    peer.reconnect()
                }, delayMs)
            })

            // ---------------------------------------------------------------------
            // Dispatcher global entrant: DataConnection
            // ---------------------------------------------------------------------
            bind('connection', async (conn) => {
                const metadata = conn?.metadata || conn?.options?.metadata || {}

                // PREMIER garde du chemin, et sa position fait tout : le `console.warn`
                // ci-dessous journalise l'objet metadata ENTIER, et c'est le pair distant
                // qui décide de le déclencher (il contrôle `callbackKey`, donc le fait
                // qu'aucun contexte ne se résolve). Placé après, ce contrôle serait vide
                // de son objet.
                if (!isPayloadWithinLimit(metadata, '[Admission] metadata', MAX_METADATA_BYTES)) {
                    try { conn.close() } catch (e) { /* ignore */ }
                    return
                }

                const targetCtx = resolveContextByMetadata(metadata, peerStore)

                if (!targetCtx) {
                    console.warn(
                        "[WebRTC2] Aucun contexte trouvé pour connection entrante — connexion fermée",
                        metadata
                    )
                    try { conn.close() } catch (e) { /* ignore */ }
                    return
                }

                // Authentification: l'émetteur doit être un membre autorisé de la room.
                let admitted = _admitIncoming(metadata, conn, targetCtx)
                if (typeof admitted !== 'boolean') admitted = await admitted

                if (!admitted) {
                    try { conn.close() } catch (e) { /* ignore */ }
                    return
                }

                targetCtx.setUpConnectionListeners(conn)
            })

            // ---------------------------------------------------------------------
            // Dispatcher global entrant: MediaConnection (call stream/screen)
            // ---------------------------------------------------------------------
            bind('call', async (call) => {
                const metadata = call?.metadata || {}

                // Même garde, même position que sur le chemin data — cf. son commentaire.
                if (!isPayloadWithinLimit(metadata, '[Admission] metadata', MAX_METADATA_BYTES)) {
                    try { call.close() } catch (e) { /* ignore */ }
                    return
                }

                // `metadata.type` est fourni par le pair distant : on le passe par la
                // sanitization centralisée (VALID_CONNECTION_TYPES) avant tout usage,
                // puis on exclut 'data' qui n'a pas de sens sur une MediaConnection.
                const callType = sanitizeMetadataType(metadata?.type)

                if (!callType || callType === 'data') {
                    return
                }

                const targetCtx = resolveContextByMetadata(metadata, peerStore)

                if (!targetCtx) {
                    console.warn(
                        "[WebRTC2] Aucun contexte trouvé pour call entrant — appel fermé",
                        metadata
                    )
                    try { call.close() } catch (e) { /* ignore */ }
                    return
                }

                // Authentification: l'appelant doit être un membre autorisé de la room
                // (sinon il recevrait le stream local sans aucune vérification).
                let admitted = _admitIncoming(metadata, call, targetCtx)
                if (typeof admitted !== 'boolean') admitted = await admitted

                if (!admitted) {
                    try { call.close() } catch (e) { /* ignore */ }
                    return
                }

                const getLocalStream = () => targetCtx.media?.currentStream || null
                const getLocalScreenStream = () => targetCtx.media?.screenStream || null
                const isOneWay = callType === 'stream' || callType === 'screen'

                if (isOneWay) {
                    // Trace exacte « un flux de ce pair est en route » : un appel one-way
                    // n'est émis que si l'émetteur a un flux vivant (cf. connectToPeer), et
                    // cet événement arrive dès la réception de l'offre — avant ICE, donc
                    // avant le `stream`. C'est ce qui couvre la fenêtre « A diffuse déjà,
                    // B arrive » que l'annonce data channel ne peut pas couvrir (le canal
                    // data naît avec l'appel). `metadata.from` est authentifié juste au-dessus
                    // par _isAuthorizedIncomingPeer : sur un appel ENTRANT c'est bien le
                    // distant, et il ne peut pas être le slug d'un autre membre.
                    targetCtx.markAnnouncedStream?.(metadata?.from, 'call')

                    // 'screen' : strictement unidirectionnel par connexion. Si le récepteur
                    // partage lui aussi son écran, il initie sa propre peer.call séparée.
                    // Répondre avec currentStream (webcam) injecterait B-webcam dans la
                    // connexion 'screen' du caller → doublon avec la connexion 'visio'
                    // déjà active (remoteStreamsMap aurait `B-visio` ET `B-screen`
                    // pointant sur le même MediaStream).
                    const answerStream = callType === 'screen'
                        ? (getLocalScreenStream() || undefined)
                        : (getLocalStream() || undefined)
                    call.answer(answerStream)
                    targetCtx.setUpConnectionListeners(call)
                    return
                }

                // Attend le stream local via watch réactif (évite le polling)
                const waitForLocalStream = (timeoutMs = STREAM_WAIT_TIMEOUT_MS) => {
                    return new Promise((resolve) => {
                        const current = getLocalStream()
                        if (current) { resolve(current); return }

                        let timeoutId
                        const stop = watch(
                            () => targetCtx.media?.currentStream,
                            (val) => {
                                if (val) {
                                    clearTimeout(timeoutId)
                                    stop()
                                    resolve(val)
                                }
                            },
                            { immediate: false }
                        )
                        timeoutId = setTimeout(() => { stop(); resolve(null) }, timeoutMs)
                    })
                }

                let localStream = await waitForLocalStream()

                if (!localStream) {
                    console.warn('Call entrant ignoré: aucun stream local disponible pour répondre', call)
                    return
                }

                call.answer(localStream)
                targetCtx.setUpConnectionListeners(call)
            })

            // ── Rafraîchissement du credential TURN ───────────────────────────────
            // Armé avec le TTL du MÊME aller-retour que la configuration qu'on vient de poser sur
            // le `Peer` : les deux décrivent le même credential. `null` (invité, mode statique,
            // repli STUN) n'arme rien.
            //
            // ICI, après les `bind`, et non avant : un `Peer` sans ses listeners n'est pas encore
            // un singleton exploitable, et une exception au milieu du branchement ne doit pas
            // laisser derrière elle un minuteur qui interrogera la route pendant des heures.
            //
            // ⚠️ Pas de `resetIceRefreshAttempts()` ici : le compteur est déjà remis à zéro par
            // `resetPeerState`, donc un Peer neuf part toujours d'un compte juste. L'ajouter
            // masquerait une seule chose — un Peer né SANS passer par un reset — qui est
            // précisément ce que `peerStateViolations` est là pour faire remonter.
            _scheduleIceRefresh(peerStore, ctx, peer, credentialTtlMs)

            // ── Rafraîchissement de l'attestation ─────────────────────────────────
            // Même place et mêmes raisons que le minuteur ci-dessus, avec le TTL du MÊME
            // aller-retour que l'attestation qu'on vient de poser. `null` (mécanisme inactif,
            // repli) n'arme rien.
            //
            // Le `peerId` est CAPTURÉ ici, jamais relu depuis le store à l'échéance : `_id` est mis
            // à `null` par `Peer.disconnect()` et restauré depuis `lastLocalPeerId` à la
            // reconnexion, donc un minuteur qui se réveillerait pendant une coupure ferait attester
            // `null`. L'identité à réattester est celle de l'instance visée, et elle ne change pas
            // de sa naissance à sa destruction.
            _scheduleAttestationRefresh(peerStore, ctx, peer, peerId, attestation.ttlMs)

            // ── Dernière étape : attendre que le pair soit réellement joignable ────
            //
            // ICI, et rien après : tout ce qui précède décrit le `Peer` qu'on vient de
            // construire et n'a aucune raison d'attendre le réseau — `_scheduleIceRefresh` le
            // premier, dont l'échéance se calcule sur le TTL du MÊME aller-retour ICE, un
            // fait déjà acquis. Corollaire à ne pas perdre : le corps post-`await` est vide,
            // donc il n'y a PAS de seconde garde d'annulation à écrire. Le jour où une
            // instruction s'ajoute en dessous, il en faudra une (`peerStore.localPeer !== peer`).
            let openTimeoutId = null

            await Promise.race([
                openPromise,
                new Promise((_resolve, reject) => {
                    openTimeoutId = setTimeout(() => {
                        console.error(
                            `[WebRTC2] Le Peer n'a jamais reçu son 'open' (${PEER_OPEN_TIMEOUT_MS} ms) — init abandonnée.`
                        )

                        // ⚠️ DÉTRUIRE, pas seulement oublier. Le `.catch` de l'init se contente
                        // de nuller `localPeer` : sur une instance VIVANTE, cela laisserait une
                        // socket ouverte et un peerId enregistré côté serveur PeerJS, désormais
                        // hors d'atteinte de `_destroyPeerSingleton` — qui n'agit que sur
                        // `peerStore.localPeer`. Ce serait un peerId fantôme de plus, par un
                        // chemin neuf, et c'est la famille de bugs la plus coûteuse du module.
                        //
                        // Garde d'identité : ce minuteur peut se réveiller alors que le
                        // singleton n'est plus le nôtre (destruction pendant l'attente, init
                        // plus récente ayant pris la main). Détruire alors, ce serait détruire
                        // le peer d'un autre.
                        if (peerStore.localPeer === peer) {
                            _destroyPeerSingleton(peerStore, `'open' jamais reçu (${PEER_OPEN_TIMEOUT_MS} ms)`)
                        }

                        reject(new Error(`[WebRTC2] Peer sans 'open' après ${PEER_OPEN_TIMEOUT_MS} ms`))
                    }, PEER_OPEN_TIMEOUT_MS)
                }),
            ]).finally(() => clearTimeout(openTimeoutId))

        } // end _doInit

        // Sert uniquement à nommer la transition dans l'audit du `finally` (cf. plus bas) :
        // l'état ne devient contradictoire qu'une fois la garde d'init libérée.
        let initFailed = false

        const initPromise = _doInit()
            .catch(err => {
                // En cas d'échec : l'`'open'` n'a jamais été reçu, donc la phase n'a jamais
                // atteint `ready` ; `localPeer` est remis à null pour permettre un retry.
                // Le compteur de consommateurs N'EST PAS remis à 0 ici : les
                // consommateurs actifs (composants montés) doivent continuer à
                // décrémenter normalement via onUnmounted — les remettre à 0 ici
                // créerait un décalage si un nouveau composant s'enregistre avant que
                // les anciens démontent, pouvant déclencher la destruction d'un peer
                // valide. _destroyPeerSingleton gère explicitement le cas localPeer=null
                // (resetPeerState, qui ne touche pas aux consommateurs).
                //
                // ⚠️ Les DEUX moitiés de l'identité s'oublient ensemble. L'id historique
                // survivait ici parce que `waitForMeReady` en dépendait ; il ne le lit plus
                // (il lit l'identité COURANTE), et les deux lecteurs de production restants
                // — `peer._id` restauré à l'`'open'` d'une reconnexion, `peer._lastServerId`
                // avant `reconnect()` — exigent tous deux une instance vivante, donc aucun
                // n'est sur ce chemin. Le laisser posé décrivait un peer que rien ne pouvait
                // plus joindre (`id-historique-sans-peer`).
                //
                // ⚠️ Champ par champ, et surtout PAS `resetPeerState()` : il nullerait aussi
                // `peerInitPromise`, ce qui ferait échouer le garde d'identité du `.finally`
                // ci-dessous — plus de nettoyage de la garde, plus d'audit, en silence.
                //
                // ⚠️ GARDE D'IDENTITÉ, rendue obligatoire par l'attente de l'`'open'`.
                //
                // Elle était superflue, et la preuve tenait en une phrase : le seul `await` du
                // corps de `_doInit` était celui de l'ICE, immédiatement suivi de sa garde
                // d'annulation ; tout ce qui pouvait jeter ensuite était SYNCHRONE, donc l'init
                // qui échouait ne pouvait être que la courante. CETTE PREUVE TOMBE — il y a
                // désormais un second point de suspension, long de plusieurs secondes, et deux
                // façons d'en sortir en échec (erreur PeerJS tardive, minuteur). Sans ce garde,
                // une init périmée qui expire nulle le `localPeer` d'une init PLUS RÉCENTE, et
                // la session repart de zéro sans une ligne d'erreur.
                //
                // Ce n'est PAS le piège du `resetPeerState()` ci-dessus : ce garde ne fait que
                // LIRE. Quand il passe, la promesse est toujours la nôtre et le `.finally` fait
                // son travail entier ; quand il ne passe pas, l'état décrit le peer de
                // quelqu'un d'autre et le `.finally` se tait pour exactement la même raison.
                // Sur le chemin du minuteur, où `_destroyPeerSingleton` a nullé
                // `peerInitPromise`, l'audit n'est pas perdu pour autant : il le fait lui-même,
                // sous le nom de la transition qui a réellement eu lieu.
                if (peerStore.peerInitPromise !== initPromise) {
                    console.info(
                        '[WebRTC2] Init du Peer terminée en échec alors qu\'elle n\'est plus la courante ' +
                        '(abandon, supplantation, ou destruction déjà faite) — l\'état courant n\'est pas touché :',
                        err
                    )
                    return
                }

                console.error('[WebRTC2] Échec d\'initialisation du Peer :', err)
                peerStore.localPeer = null
                peerStore.lastLocalPeerId = null
                peerStore.markPeerAbsent('après échec d\'init du Peer')
                initFailed = true
            })
            .finally(() => {
                // Ne nettoyer que SA propre promesse : maintenant qu'elle est partagée par
                // le store, une init tardive (cycle destroy → nouvelle init pendant que
                // l'ancienne est encore en vol) effacerait la garde de la plus récente et
                // laisserait un troisième consommateur créer un second Peer.
                if (peerStore.peerInitPromise === initPromise) {
                    peerStore.setPeerInitPromise(null)

                    // ⚠️ ICI et pas dans le `.catch` : tant que la garde d'init est posée,
                    // l'état « pas de peer » est LÉGITIME (c'est la phase `creating`). Une
                    // contradiction ne peut donc apparaître qu'à la ligne du dessus. Sur un
                    // échec, cet audit est SILENCIEUX, et c'est le fait à tenir : le `.catch`
                    // n'a plus rien laissé derrière lui — ni instance, ni id historique. Le
                    // jour où il rougit sur `id-historique-sans-peer`, c'est qu'un chemin a
                    // recommencé à préserver l'un sans l'autre.
                    //
                    // Et seulement dans ce `if` : si une init plus récente a pris la main,
                    // l'état décrit le peer de QUELQU'UN D'AUTRE et un audit l'imputerait à
                    // cette transition-ci.
                    peerStore.auditPeerState(initFailed ? 'après échec d\'init du Peer' : 'après init du Peer')
                }
            })

        peerStore.setPeerInitPromise(initPromise)
        return initPromise
    }

    const unregisterLocalContext = () => {
        unregisterContext(ctx)
    }

    const _getOpenDataConnection = (room, userSlug, type = 'data') => {
        const roomConnections = ctx.peerStore.getConnections?.[room]?.[userSlug]?.[type] ?? []
        
        if (!Array.isArray(roomConnections) || roomConnections.length === 0) {
            return null
        }

        // cherche une connexion ouverte avec un datachannel actif (fallback conn=null si aucune)
        return roomConnections.find(conn => conn?.open && conn?.chunker) ?? null
    }

    /**
     * Slugs de la room joignables MAINTENANT par le data channel.
     *
     * Exposé parce que `sendData` warne par destinataire injoignable : un appelant dont
     * l'envoi est opportuniste (annonce de diffusion) doit pouvoir se taire au lieu de
     * remplir la console sur un chemin normal. En star, la seule connexion d'un client
     * est celle du hub — la liste vaut donc « ai-je un canal du tout ? ».
     *
     * @returns {string[]}
     */
    const getDataReachablePeers = () => {
        const room = ctx.session.onAirRoom
        const type = ctx.session.currentType
        const users = Array.isArray(ctx.connection.remotePeers) ? ctx.connection.remotePeers : []

        return users.filter(userSlug => !!_getOpenDataConnection(room, userSlug, type))
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 🔁 forwardStarMessage — utilisée UNIQUEMENT par le hub en topologie star
    //
    // Quand le hub reçoit un message d'un client avec __starRoute: true,
    // il appelle cette fonction pour le retransmettre aux bons destinataires.
    //
    // Paramètres de l'enveloppe :
    //   envelope.from    → champ déclaratif client (non fiable, ignoré côté hub)
    //   envelope.to      → liste de slugs ciblés, ou null pour "tout le monde"
    //   envelope.payload → les vraies données à livrer
    // ─────────────────────────────────────────────────────────────────────────────
    const forwardStarMessage = (envelope, sourceConn = null) => {
        const senderIdentity = sourceConn?.peer ? String(sourceConn.peer) : null
        if (!senderIdentity) {
            console.warn('[Hub] Enveloppe star ignorée: peerId expéditeur introuvable sur la connexion entrante', {
                declaredFrom: envelope?.from,
            })
            return
        }

        const senderSlug = _resolveSenderSlugFromIncomingConn(sourceConn, ctx)
        if (!senderSlug) {
            console.warn('[Hub] Enveloppe star ignorée: expéditeur non résolu depuis la connexion entrante', {
                senderPeerId: sourceConn?.peer,
                declaredFrom: envelope?.from,
            })
            return
        }

        // ── Rate limiting ────────────────────────────────────────────────────────
        // Protection contre les rafales de messages : si un client dépasse
        // HUB_MAX_MESSAGES_PER_WINDOW messages dans HUB_RATE_WINDOW_MS, l'excédent
        // est abandonné pour éviter la saturation du hub.
        if (_hubRateLimiter.isLimited(senderIdentity)) {
            console.warn(
                `[Hub] Rate limit dépassé (${HUB_MAX_MESSAGES_PER_WINDOW} msg/${HUB_RATE_WINDOW_MS}ms)` +
                ` — message de '${senderSlug}' (${senderIdentity}) abandonné`
            )
            return
        }

        // ── Limite de taille payload (anti-amplification DoS) ─────────────────
        // Types acceptes: JSON + binaire (Blob, File, ArrayBuffer, TypedArray)
        const payloadSize = getPayloadSizeBytes(envelope?.payload)
        if (!payloadSize.ok) {
            console.warn('[Hub] Enveloppe star ignoree: payload invalide', {
                reason: payloadSize.reason,
                senderSlug,
                senderPeerId: senderIdentity,
            })
            return
        }

        if (payloadSize.bytes > MAX_PAYLOAD_BYTES) {
            console.warn(
                `[Hub] Enveloppe star ignoree: payload trop volumineux (${payloadSize.bytes} octets > ${MAX_PAYLOAD_BYTES})`,
                {
                    payloadKind: payloadSize.kind,
                    senderSlug,
                    senderPeerId: senderIdentity,
                }
            )
            return
        }

        const room = ctx.session.onAirRoom
        const type = ctx.session.currentType

        // Membres réels de la room : seule source de vérité pour les destinataires.
        const remotePeers = Array.isArray(ctx.connection.remotePeers)
            ? ctx.connection.remotePeers
            : []

        // Si `to` est fourni, on le traite comme une demande de ciblage NON fiable :
        // chaque slug doit avoir un format valide ET appartenir à la room courante.
        // Tout slug forgé / hors room est rejeté silencieusement. Sinon (to absent),
        // on cible tous les membres de la room.
        // Dans les deux cas, on exclut l'expéditeur (inutile de lui renvoyer son propre message).
        let targets
        if (Array.isArray(envelope.to)) {
            targets = envelope.to.filter(slug =>
                _isValidSlug(slug) && remotePeers.includes(slug)
            )
        } else {
            targets = [...remotePeers]
        }
        targets = targets.filter(slug => slug !== senderSlug)

        // Rien à retransmettre : ne pas consommer de budget pour un fan-out vide.
        if (targets.length === 0) {
            return
        }

        // ── Budget d'octets agrégé (anti-amplification) ──────────────────────────
        // Les deux gardes ci-dessus sont par expéditeur et par message ; leur PRODUIT
        // par le fan-out ne l'était pas — à 100 membres, 20 msg/s × 64 Ko font sortir
        // ~128 Mo/s d'un onglet navigateur. Le coût réel d'une retransmission est
        // `octets × destinataires`, et c'est ce coût qui est plafonné, sur la même clé.
        //
        // ⚠️ Un message coupé ici a déjà consommé un jeton du plafond de messages : la
        // tentative est réelle, elle compte. Et le contrôle porte sur le total déjà
        // dépensé (cf. `createRateLimiter`), donc un premier fan-out coûteux passe et
        // consomme sa fenêtre — c'est l'amplification soutenue qui est visée.
        const fanoutCost = payloadSize.bytes * targets.length

        if (_hubByteLimiter.isLimited(senderIdentity, fanoutCost)) {
            console.warn(
                `[Hub] Budget d'octets dépassé (${HUB_MAX_BYTES_PER_WINDOW} o/${HUB_RATE_WINDOW_MS}ms)` +
                ` — message de '${senderSlug}' (${senderIdentity}) abandonné`,
                {
                    payloadBytes: payloadSize.bytes,
                    targets: targets.length,
                    fanoutCost,
                }
            )
            return
        }

        targets.forEach(userSlug => {
            const conn = _getOpenDataConnection(room, userSlug, type)
            if (!conn) {
                console.warn('[Hub] Retransmission ignorée: connexion indisponible pour', userSlug)
                return
            }
            // On envoie uniquement le payload (sans l'enveloppe de routage)
            conn.send(envelope.payload)
        })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 📤 sendData — envoie des données à un ou plusieurs peers
    //
    // Comportement selon la topologie :
    //
    //   MESH : envoi direct à chaque peer connecté (via leur connexion datachannel respective)
    //
    //   STAR hub    : envoi direct aux destinataires (le hub a une connexion avec tout le monde)
    //   STAR client : envoi au hub dans une "enveloppe" → le hub se chargera de retransmettre
    //
    //   SFU : non géré ici (le serveur SFU fait le routage lui-même)
    // ─────────────────────────────────────────────────────────────────────────────
    const sendData = (data, destUserSlugs = null) => {

        const room = ctx.session.onAirRoom
        const type = ctx.session.currentType

        // ── TOPOLOGIE MESH ──────────────────────────────────────────────────────
        // Chaque peer est connecté à tous les autres → on envoie directement à chacun.
        if (ctx.topology.value === 'mesh') {
            // Limite de taille payload (anti-DoS pair-à-pair) : le même `data` est
            // diffusé à tous les pairs, on contrôle donc la taille une seule fois
            // avant la boucle et on annule entièrement l'envoi si elle dépasse
            // MAX_PAYLOAD_BYTES (JSON + binaire).
            if (!isPayloadWithinLimit(data, '[Mesh]')) return

            const targets = destUserSlugs || ctx.connection.remotePeers
            targets.forEach(userSlug => {
                const conn = _getOpenDataConnection(room, userSlug, type)
                if (!conn) {
                    console.warn('[Mesh] Envoi ignoré: connexion indisponible pour', userSlug)
                    return
                }
                conn.send(data)
            })
            return
        }

        // ── TOPOLOGIE STAR ──────────────────────────────────────────────────────
        if (ctx.topology.value === 'star' && ctx.hubSlug.value) {

            // CAS 1 — Je suis le hub
            // Le hub est connecté à tout le monde → envoi direct aux destinataires.
            if (ctx.isHub.value) {
                const targets = destUserSlugs || ctx.connection.remotePeers
                targets.forEach(userSlug => {
                    const conn = _getOpenDataConnection(room, userSlug, type)
                    if (!conn) {
                        console.warn('[Hub] Envoi ignoré: connexion indisponible pour', userSlug)
                        return
                    }
                    conn.send(data)
                })
                return
            }

            // CAS 2 — Je suis un client
            // Je suis uniquement connecté au hub.
            // Je lui envoie une "enveloppe" contenant les destinataires voulus + mes données.
            // Le hub interceptera cette enveloppe et retransmettra lui-même.
            const envelope = {
                __starRoute: true,          // 🚩 marqueur : "hub, retransmet ce message"
                to: destUserSlugs || null,  // destinataires cibles (null = tout le monde sauf moi)
                from: ctx.mySlug.value,     // mon slug → le hub m'exclura de la retransmission
                payload: data,              // les vraies données à livrer
            }

            const conn = _getOpenDataConnection(room, ctx.hubSlug.value, type)
            if (!conn) {
                console.warn('[Client] Envoi ignoré: connexion hub indisponible', ctx.hubSlug.value)
                return
            }
            conn.send(envelope)
        }
    }

    return {
        setLocalPeer,
        unregisterLocalContext,
        sendData,
        getDataReachablePeers,
        forwardStarMessage,
    }
}