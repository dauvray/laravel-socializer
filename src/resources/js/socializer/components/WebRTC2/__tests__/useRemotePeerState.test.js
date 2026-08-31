/**
 * useRemotePeerState.test.js — l'état d'un pair distant, tel que son datachannel le dit
 *
 * Le seul protocole applicatif des Widgets : un pair coupe son micro ou sa caméra, l'annonce
 * (`AUDIO_MUTE_TOGGLE` / `VIDEO_ACTIVE_TOGGLE`) part par le datachannel, et c'est ce composable
 * qui la traduit en deux booléens réactifs. Jusqu'ici, l'émission était couverte
 * (`GroupLocalStreamBtn.test.js`) et le transport aussi, mais **rien n'assertait que le message
 * produise le moindre effet à l'arrivée**.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * **Le semis passe par l'action réelle `dispatchSignal`, jamais par une écriture directe dans
 * `signalQueues`.** C'est l'unique écrivain de cette map en production, et lui seul pose
 * l'enveloppe (`ts`, `seq`, plafond à 10 par file). Écrire la file à la main laisserait le test
 * inventer une forme que la production n'écrit jamais — le piège « un mock qui ment ».
 *
 * **`withSetup` est obligatoire ici** : le composable enregistre `onUnmounted`. C'est l'exemple
 * exact de la règle du paquet, et son voisin de dossier `useMediaControls` est de l'autre côté
 * (aucun hook, aucun `inject` : il s'appelle nu).
 *
 * La charge des toggles reproduit celle de la production, `roomId` compris — que **personne ne
 * lit** à la réception (cas « le `roomId` de la charge n'est pas la clé »). La clé de file est
 * `conn.peer`, posée par l'enveloppe.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 *
 *    1. branche `case 'AUDIO_MUTE_TOGGLE'` retirée ......................... 8 cas
 *    2. branche `case 'VIDEO_ACTIVE_TOGGLE'` retirée ....................... 6 cas
 *    3. `!!` retiré sur les deux charges ................................... 1 cas
 *    4. clé de lecture figée (`getLastRoomSignal('peer-alice')`) ........... 2 cas
 *    5. `unref(peerIdSource)` remplacé par une capture initiale ............ 1 cas
 *    6. garde `peerId ? … : null` du `computed` retiré ..................... 1 cas
 *    7. `switch` remplacé par une écriture inconditionnelle de `muted` ..... 7 cas
 *    8. `if (!signal)` retiré ............................................. 15 cas
 *    9. `onUnmounted(stop)` retiré ......................................... 0 cas
 *   10. `{ immediate: true }` retiré ....................................... 2 cas
 *
 * ℹ️ **Tous ces chiffres sont ceux d'APRÈS `immediate: true`** : le correctif change l'instant
 * d'exécution du watcher, donc les contrôles des trois fichiers du lot ont été re-mesurés
 * intégralement après lui. Le n° 8 est celui qui a le plus bougé (2 → 15) : sous `immediate`,
 * le watcher tourne au montage de CHAQUE cas, et une file vide y lève désormais.
 *
 * ⚠️ **Le n° 9 est le seul 0 toléré du fichier, et ce n'est pas une faute du test.** Le `watch`
 * est créé dans le `setup()` du composant : l'`EffectScope` de ce composant l'arrête déjà au
 * démontage. Deux mécanismes indépendants tiennent la même propriété, et la règle du paquet
 * voudrait qu'on neutralise les deux — sauf qu'ici le second est le framework, qu'on ne peut pas
 * neutraliser. Le cas « le watcher s'arrête au démontage » reste : il rougira si le `watch` migre
 * hors du `setup()`, ou dans un `effectScope` que personne n'arrête. Mesuré trois fois.
 *
 * ℹ️ **Un dixième contrôle a mesuré 0 trois fois, et a fait SUPPRIMER la ligne** (sortie B) :
 * `|| signal.roomId !== peerId`, qui gardait l'appartenance du signal au pair. Il était
 * structurellement inatteignable — `dispatchSignal` indexe la file PAR `signal.roomId`, donc tout
 * signal rendu par `getLastRoomSignal(X)` a `roomId === X` par construction. Précédent
 * `isValidSlug` : un garde qu'aucune contre-épreuve ne fait rougir se supprime, il ne se commente
 * pas. Ce qui protège réellement est le `switch` sans `default` (n° 7, 6 cas).
 *
 * ⚠️ Le n° 4 rougit 2 et non 3 : le garde `!peerId` (n° 6) rend `null` avant toute lecture pour
 * la vignette sans pair, qui reste donc verte sous une clé figée. Les deux contrôles se
 * recouvrent, et c'est pour ça qu'ils sont mesurés séparément.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useRemotePeerState } from '~socializer/components/WebRTC2/Widgets/Mediaplayer/Composables/useRemotePeerState.js'
import { withSetup } from './helpers/withSetup.js'

const apps = []

afterEach(() => {
    while (apps.length) {
        apps.pop().unmount()
    }
})

const monter = (peerIdSource) => {
    const [etat, app] = withSetup(() => useRemotePeerState(peerIdSource))
    apps.push(app)
    return etat
}

/**
 * La charge exacte qu'écrit `GroupLocalStreamBtn` — `roomId` compris, qui n'est lu par personne
 * à la réception. L'enveloppe, elle, est posée par `StreamSimpleUI.handleStreamData` à partir de
 * `conn.peer` : c'est ELLE qui porte la clé de file.
 */
const annoncerMicro = (peerStore, peerId, isMuted, roomIdCharge = 'room-a-l-antenne') =>
    peerStore.dispatchSignal({
        emitter: 'test',
        roomId: peerId,
        payload: { roomId: roomIdCharge, type: 'AUDIO_MUTE_TOGGLE', isMuted },
    })

const annoncerCamera = (peerStore, peerId, isActive, roomIdCharge = 'room-a-l-antenne') =>
    peerStore.dispatchSignal({
        emitter: 'test',
        roomId: peerId,
        payload: { roomId: roomIdCharge, type: 'VIDEO_ACTIVE_TOGGLE', isActive },
    })

describe('useRemotePeerState — l\'état distant que porte le datachannel', () => {

    describe('le protocole des deux toggles', () => {
        it('⭐ couper son micro l\'affiche en sourdine, le rouvrir l\'annule', async () => {
            // Les deux sens sont nécessaires : à sens unique, « suit l'annonce » et « se met à
            // vrai une fois » donnent le même vert.
            const peerStore = usePeer2Store()
            const etat = monter('peer-alice')

            annoncerMicro(peerStore, 'peer-alice', true)
            await nextTick()
            expect(etat.muted.value).toBe(true)

            annoncerMicro(peerStore, 'peer-alice', false)
            await nextTick()
            expect(etat.muted.value).toBe(false)
        })

        it('⭐ couper sa caméra éteint la vidéo, la rallumer la remet', async () => {
            const peerStore = usePeer2Store()
            const etat = monter('peer-alice')

            annoncerCamera(peerStore, 'peer-alice', false)
            await nextTick()
            expect(etat.videoActive.value).toBe(false)

            annoncerCamera(peerStore, 'peer-alice', true)
            await nextTick()
            expect(etat.videoActive.value).toBe(true)
        })

        it('⭐ les deux pistes ne se confondent jamais', async () => {
            // Les deux branches du `switch` sont deux copies l'une de l'autre : un copier-coller
            // du champ lu (`isMuted` / `isActive`) serait invisible sans cette assertion croisée.
            const peerStore = usePeer2Store()
            const etat = monter('peer-alice')

            annoncerMicro(peerStore, 'peer-alice', true)
            await nextTick()
            expect(etat.videoActive.value).toBe(true)

            annoncerCamera(peerStore, 'peer-alice', false)
            await nextTick()
            expect(etat.muted.value).toBe(true)
        })

        it('la charge est lue en booléen, quoi qu\'elle porte', async () => {
            // Le `!!` : un pair d'une version antérieure — ou une app hôte — peut annoncer un
            // entier. Ce qui traverse jusqu'au `v-if` du player doit être un booléen.
            const peerStore = usePeer2Store()
            const etat = monter('peer-alice')

            // ⚠️ Le tick entre les deux n'est pas décoratif : sans lui les deux annonces se
            // coalescent et la première est perdue (cf. le pin plus bas). Ce cas-ci a rougi de
            // cette faute-là avant d'être écrit ainsi.
            annoncerMicro(peerStore, 'peer-alice', 1)
            await nextTick()
            annoncerCamera(peerStore, 'peer-alice', 0)
            await nextTick()

            expect(etat.muted.value).toBe(true)
            expect(etat.videoActive.value).toBe(false)
        })

        it('avant toute annonce : micro ouvert et vidéo active', () => {
            // Ce sont les défauts optimistes du composable, et ils sont un choix : un pair déjà
            // en sourdine AVANT notre arrivée s'affiche micro ouvert jusqu'à son prochain toggle.
            const etat = monter('peer-alice')

            expect(etat.muted.value).toBe(false)
            expect(etat.videoActive.value).toBe(true)
        })
    })

    describe('la portée : une file par pair', () => {
        it('⭐ une annonce n\'atteint que le pair qui l\'a émise', async () => {
            // Les DEUX moitiés sont nécessaires. Avec un seul pair monté, « la bonne file » et
            // « une file » donnent le même vert — c'est le piège mesuré du paquet (« un seul
            // pair ne distingue pas cible précise de tout le monde »).
            const peerStore = usePeer2Store()
            const alice = monter('peer-alice')
            const bob = monter('peer-bob')

            annoncerMicro(peerStore, 'peer-alice', true)
            await nextTick()
            expect(alice.muted.value).toBe(true)
            expect(bob.muted.value).toBe(false)

            annoncerCamera(peerStore, 'peer-bob', false)
            await nextTick()
            expect(bob.videoActive.value).toBe(false)
            expect(alice.videoActive.value).toBe(true)
        })

        it('le `roomId` porté par la CHARGE n\'est pas la clé', async () => {
            // `GroupLocalStreamBtn` met sa room dans la charge (`onAirRoom`) et personne ne la
            // lit : le routage se fait sur `conn.peer`, posé par l'enveloppe. Une charge annonçant
            // une room étrangère doit donc s'appliquer quand même.
            const peerStore = usePeer2Store()
            const etat = monter('peer-alice')

            annoncerMicro(peerStore, 'peer-alice', true, 'une-room-qui-n-est-pas-la-mienne')
            await nextTick()

            expect(etat.muted.value).toBe(true)
        })
    })

    describe('ce qui n\'est pas un toggle', () => {
        it('⭐ une enveloppe SERVEUR posée sur la même file ne change rien', async () => {
            // Deux conventions cohabitent dans `signalQueues`, séparées par la seule forme de la
            // clé : les signaux serveur (`{roomId:'<type>-<contextId>', type, payload}`, routés
            // par `useSignalingQueue`) et les projections d'état des Widgets. Ce qui protège de
            // l'une posée sur la file de l'autre est le `switch` SANS `default` — pas un garde
            // d'appartenance, qui serait structurellement inatteignable ici.
            const peerStore = usePeer2Store()
            const etat = monter('peer-alice')

            peerStore.dispatchSignal({
                roomId: 'peer-alice',
                type: 'PEER_CONNECTION_REQUEST',
                payload: { fromSlug: 'bob', peerId: 'peer-bob' },
            })
            await nextTick()

            expect(etat.muted.value).toBe(false)
            expect(etat.videoActive.value).toBe(true)
        })

        it('un type inconnu ne change rien', async () => {
            const peerStore = usePeer2Store()
            const etat = monter('peer-alice')

            peerStore.dispatchSignal({
                roomId: 'peer-alice',
                payload: { type: 'BROADCAST_STATE', isBroadcasting: true },
            })
            await nextTick()

            expect(etat.muted.value).toBe(false)
            expect(etat.videoActive.value).toBe(true)
        })

        it('un signal sans charge ne lève pas', async () => {
            const peerStore = usePeer2Store()
            const etat = monter('peer-alice')

            peerStore.dispatchSignal({ roomId: 'peer-alice' })
            await nextTick()

            expect(etat.muted.value).toBe(false)
        })

        it('une file vidée en cours de session n\'oublie rien, et la suivante repart', async () => {
            // `clearSignalQueueRoom` tourne au départ d'un pair (`usePeerConnections`) : le
            // `computed` repasse alors à `null`. C'est le seul cas atteignable du garde `!signal`
            // — sans lui, le watcher lèverait sur la lecture de `signal.roomId`.
            const peerStore = usePeer2Store()
            const etat = monter('peer-alice')

            annoncerMicro(peerStore, 'peer-alice', true)
            await nextTick()

            peerStore.clearSignalQueueRoom('peer-alice')
            await nextTick()
            expect(etat.muted.value).toBe(true)

            annoncerMicro(peerStore, 'peer-alice', false)
            await nextTick()
            expect(etat.muted.value).toBe(false)
        })
    })

    describe('le rattrapage au montage', () => {
        it('⭐ une annonce déjà en file au montage est reprise', async () => {
            // Le datachannel s'ouvre AVANT que le flux média n'arrive, et le montage de la
            // vignette EST l'arrivée du flux. Une annonce reçue dans cette fenêtre est donc en
            // file quand le composable démarre — sans `immediate`, elle n'est jamais lue et le
            // pair s'affiche micro ouvert alors qu'il est coupé.
            const peerStore = usePeer2Store()

            annoncerMicro(peerStore, 'peer-alice', true)

            const etat = monter('peer-alice')

            expect(etat.muted.value).toBe(true)
        })

        it('seule la DERNIÈRE annonce en file est reprise — la borne du rattrapage', async () => {
            // `immediate` rejoue le dernier SIGNAL, pas l'état : un pair qui a coupé son micro
            // PUIS sa caméra avant notre arrivée ne restitue que la caméra. Reconstituer l'état
            // complet demanderait de drainer la file par type, ce que la lecture
            // `getLastRoomSignal` ne fait pas — c'est écrit ici pour que la borne ne se
            // redécouvre pas à l'usage.
            const peerStore = usePeer2Store()

            annoncerMicro(peerStore, 'peer-alice', true)
            annoncerCamera(peerStore, 'peer-alice', false)

            const etat = monter('peer-alice')

            expect(etat.videoActive.value).toBe(false)
            expect(etat.muted.value).toBe(false)
        })
    })

    describe('ce que ce composable ne fait pas — pins de statu quo', () => {
        it('⭐ deux annonces dans le MÊME tick : la première est perdue', async () => {
            // Pin, vert d'emblée et voulu tel quel aujourd'hui. `getLastRoomSignal` ne rend que
            // la dernière entrée, et un `watch` sur un `computed` ne se réveille qu'une fois par
            // flush : deux annonces sans tick entre elles se coalescent. « Dernière valeur
            // gagne » est vrai PAR CLÉ DE FILE — et la clé est le peerId, pas le type : les deux
            // pistes partagent donc un seul emplacement.
            //
            // Ce cas rougira le jour où la file sera drainée par type (item « drainer réellement
            // la file de signaux ») ; il se supprime avec ce correctif-là.
            const peerStore = usePeer2Store()
            const etat = monter('peer-alice')

            annoncerMicro(peerStore, 'peer-alice', true)
            annoncerCamera(peerStore, 'peer-alice', false)
            await nextTick()

            expect(etat.videoActive.value).toBe(false)
            expect(etat.muted.value).toBe(false)
        })

        it('⭐ changer de pair suit le nouveau, mais n\'oublie pas l\'état hérité', async () => {
            // Deux faits dans le même cas, et c'est voulu : le premier est le contrat (`unref` à
            // chaque lecture, donc une `Ref` mutable est suivie), le second est le pin — rien ne
            // réinitialise `muted`/`videoActive` au changement de source. Aucun des deux `v-for`
            // de production ne l'atteint (leurs `:key` ne recyclent que des instances sans
            // `peerId`), mais la signature publique accepte une `Ref`.
            const peerStore = usePeer2Store()
            const source = ref('peer-alice')
            const etat = monter(source)

            annoncerMicro(peerStore, 'peer-alice', true)
            await nextTick()
            expect(etat.muted.value).toBe(true)

            source.value = 'peer-bob'
            await nextTick()
            expect(etat.muted.value).toBe(true)

            annoncerCamera(peerStore, 'peer-bob', false)
            await nextTick()
            expect(etat.videoActive.value).toBe(false)
        })
    })

    describe('la surdité des flux sans pair', () => {
        it('⭐ un flux sans `peerId` n\'est atteint par aucune annonce', async () => {
            // Les vignettes de partage d'écran n'ont PAS de `peerId` (`remoteScreensData` n'en
            // pose aucun) : elles sont sourdes, et c'est voulu — règle symétrique de
            // `LocalMediaPlayer`, où un écran partagé garde toujours sa vidéo active. Un pair qui
            // coupe sa webcam ne doit pas faire disparaître son partage d'écran.
            //
            // Ce qu'il faut empêcher est plus précis que la surdité : `getLastRoomSignal(undefined)`
            // lit la clé `"undefined"`, qui est EXACTEMENT celle qu'écrit `dispatchSignal` quand
            // la connexion manque. Sans garde, tous les partages d'écran partagent une file
            // poubelle commune, qu'un seul signal sans connexion ferait basculer d'un coup.
            const peerStore = usePeer2Store()
            const ecran = monter(undefined)

            peerStore.dispatchSignal({
                roomId: undefined,
                payload: { type: 'VIDEO_ACTIVE_TOGGLE', isActive: false },
            })
            await nextTick()

            expect(ecran.videoActive.value).toBe(true)
        })
    })

    describe('cycle de vie', () => {
        it('le watcher s\'arrête au démontage', async () => {
            const peerStore = usePeer2Store()
            const [etat, app] = withSetup(() => useRemotePeerState('peer-alice'))

            app.unmount()

            annoncerMicro(peerStore, 'peer-alice', true)
            await nextTick()

            expect(etat.muted.value).toBe(false)
        })
    })
})
