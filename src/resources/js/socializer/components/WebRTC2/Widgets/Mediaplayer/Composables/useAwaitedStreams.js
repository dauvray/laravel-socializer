/**
 * ⏳ useAwaitedStreams (UI)
 *
 * Expose les pairs présents dans la room dont aucun flux n'est encore arrivé, pour que
 * l'UI puisse afficher une vignette d'attente au lieu de… rien. Sans ce retour, le délai
 * d'établissement (signalisation → peer.call → ICE, plus le backoff de retry) se lit
 * comme une panne.
 *
 * 👉 ne gère PAS :
 * - l'attente d'image sur un flux DÉJÀ reçu → c'est l'overlay de MediaBroadcastPlayer,
 *   qui s'appuie sur les events du <video> et n'a donc besoin d'aucune heuristique
 *
 * ⚠️ Heuristique assumée, et sa raison : un récepteur ne peut pas savoir localement qu'un
 * pair diffuse. `usersInRoom` contient tous les présents, diffuseurs ou non, et pour un
 * appel one-way (`stream`/`screen`) le récepteur fait `call.answer()` **sans stocker la
 * connexion** (cf. usePeerTransport) — il n'existe aucune trace observable avant
 * l'événement `stream`, qui est précisément l'arrivée du flux. On borne donc l'attente
 * dans le temps : passé `timeoutMs`, on cesse de signaler le pair plutôt que de laisser
 * un spinner tourner à vie. La seule alternative exacte serait d'annoncer l'état de
 * diffusion sur le data channel (nouveau type de signal).
 */
import { computed, ref, unref, watch, onUnmounted } from 'vue'
import { AWAITED_STREAM_TIMEOUT_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

/**
 * @param {Object} api                  API retournée par useMediaBroadcast
 * @param {Object} [options]
 * @param {number} [options.timeoutMs]  Durée d'attente avant abandon
 * @returns {{ awaitedPeers: import('vue').ComputedRef<string[]>, isAwaiting: import('vue').ComputedRef<boolean> }}
 */
export function useAwaitedStreams(api, { timeoutMs = AWAITED_STREAM_TIMEOUT_MS } = {}) {

    // Slugs pour lesquels on a cessé d'attendre (délai écoulé). Tableau plutôt que Set :
    // réassigné à chaque changement, donc réactif sans artifice.
    const abandoned = ref([])

    // Slugs dont on a DÉJÀ vu un flux. On ne les attend plus jamais : l'arrêt d'une
    // diffusion est une décision de l'émetteur, pas une attente. Sans ça, couper sa webcam
    // faisait réapparaître un spinner de 20 s chez tous les récepteurs, comme si le flux
    // allait revenir.
    const served = ref([])

    const timers = new Map()

    const _read = (source) => unref(source) ?? []

    // Un pair est « servi » dès qu'il a un flux, webcam OU écran.
    const streamingSlugs = computed(() => {
        const entries = [..._read(api?.remoteStreams), ..._read(api?.remoteScreens)]
        return new Set(entries.map((entry) => entry?.remoteSlug).filter(Boolean))
    })

    // Mémorise tout pair vu en train de diffuser, avant même de calculer l'attente.
    watch(streamingSlugs, (slugs) => {
        const fresh = [...slugs].filter((slug) => !served.value.includes(slug))
        if (fresh.length) served.value = [...served.value, ...fresh]
    }, { immediate: true })

    const awaitedPeers = computed(() =>
        _read(api?.usersInRoom).filter(
            (slug) => slug
                && !streamingSlugs.value.has(slug)
                && !served.value.includes(slug)
                && !abandoned.value.includes(slug)
        )
    )

    const isAwaiting = computed(() => awaitedPeers.value.length > 0)

    const _clearTimer = (slug) => {
        if (!timers.has(slug)) return
        clearTimeout(timers.get(slug))
        timers.delete(slug)
    }

    // Un timer par pair attendu : il s'arme à la première apparition et se désarme dès
    // que le flux arrive (ou que le pair quitte la room).
    watch(awaitedPeers, (slugs) => {
        slugs.forEach((slug) => {
            if (timers.has(slug)) return
            timers.set(slug, setTimeout(() => {
                timers.delete(slug)
                if (!abandoned.value.includes(slug)) {
                    abandoned.value = [...abandoned.value, slug]
                }
            }, timeoutMs))
        })

        // Désarme ce qui n'est plus attendu (flux reçu, ou pair parti).
        ;[...timers.keys()]
            .filter((slug) => !slugs.includes(slug))
            .forEach(_clearTimer)
    }, { immediate: true })

    // Un pair qui quitte la room doit repartir d'une ardoise vierge : s'il revient et
    // diffuse, on doit l'attendre à nouveau. Vaut pour les deux mémoires.
    watch(() => _read(api?.usersInRoom), (slugs) => {
        const present = new Set(slugs)

        const keptAbandoned = abandoned.value.filter((slug) => present.has(slug))
        if (keptAbandoned.length !== abandoned.value.length) {
            abandoned.value = keptAbandoned
        }

        const keptServed = served.value.filter((slug) => present.has(slug))
        if (keptServed.length !== served.value.length) {
            served.value = keptServed
        }
    })

    onUnmounted(() => {
        timers.forEach((timer) => clearTimeout(timer))
        timers.clear()
    })

    return {
        awaitedPeers,
        isAwaiting,
    }
}
