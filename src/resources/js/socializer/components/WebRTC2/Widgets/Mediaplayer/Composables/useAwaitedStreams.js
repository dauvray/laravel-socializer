/**
 * ⏳ useAwaitedStreams (UI)
 *
 * Expose les pairs dont un flux est ANNONCÉ mais pas encore arrivé, pour que l'UI
 * puisse afficher une vignette d'attente au lieu de… rien. Sans ce retour, le délai
 * d'établissement (ICE, premières frames, backoff de retry) se lit comme une panne.
 *
 * 👉 ne gère PAS :
 * - l'attente d'image sur un flux DÉJÀ reçu → c'est l'overlay de MediaBroadcastPlayer,
 *   qui s'appuie sur les events du <video> et n'a donc besoin d'aucune heuristique
 *
 * ✅ PLUS D'HEURISTIQUE (2026-08-13). Ce composable attendait auparavant **tout** pair
 * présent dans `remotePeers`, faute de pouvoir savoir localement qui diffuse : un
 * membre qui ne diffusait pas affichait donc une vignette d'attente pendant tout le
 * délai d'abandon (symptôme rapporté : « le spinner s'affiche même si aucun stream
 * n'est actif, puis disparaît »). La source est désormais un FAIT, `announcedStreamPeers`
 * (`ctx.media.announcedStreamsMap`), alimenté par trois chemins exacts :
 *   - l'annonce `BROADCAST_STATE` reçue sur le data channel (useBroadcastPresence) ;
 *   - l'appel one-way entrant, qui n'existe que si l'émetteur a un flux vivant
 *     (usePeerTransport) et arrive dès l'offre, avant ICE ;
 *   - l'`isBroadcasting` embarqué sur les deux routes de peerId (usePeerCore à
 *     l'émission, noteBroadcastFromSignal à la réception) — le seul qui n'exige aucun
 *     contact P2P, donc le seul qui puisse afficher quelque chose dans la première
 *     seconde d'une arrivée.
 * Conséquence : **aucune vignette quand personne ne diffuse**, et un pair qui arrête sa
 * diffusion voit son annonce purgée (useCallManager.handleRemoteDeparture) — d'où la
 * disparition de l'ancienne mémoire `served`, qui compensait ça au prix d'un pair
 * définitivement non attendu.
 *
 * ⚠️ `timeoutMs` reste, mais comme FILET et non comme mécanisme : un pair peut avoir
 * annoncé un flux qui n'arrivera jamais (canal data vivant, chemin média cassé). Sans
 * borne, la vignette tournerait à vie. Une nouvelle annonce du même pair réarme
 * l'attente (l'abandon n'est pas définitif tant qu'il reste dans la room).
 */
import { computed, ref, unref, watch, onUnmounted } from 'vue'
import { AWAITED_STREAM_TIMEOUT_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

/**
 * @param {Object} api                  API retournée par useMediaBroadcast
 * @param {Object} [options]
 * @param {number} [options.timeoutMs]  Durée d'attente avant abandon (filet)
 * @returns {{ awaitedPeers: import('vue').ComputedRef<string[]>, isAwaiting: import('vue').ComputedRef<boolean> }}
 */
export function useAwaitedStreams(api, { timeoutMs = AWAITED_STREAM_TIMEOUT_MS } = {}) {

    // Slugs pour lesquels on a cessé d'attendre (délai écoulé). Tableau plutôt que Set :
    // réassigné à chaque changement, donc réactif sans artifice.
    const abandoned = ref([])

    const timers = new Map()

    const _read = (source) => unref(source) ?? []

    // Un pair est « servi » dès qu'il a un flux, webcam OU écran.
    const streamingSlugs = computed(() => {
        const entries = [..._read(api?.remoteStreams), ..._read(api?.remoteScreens)]
        return new Set(entries.map((entry) => entry?.remoteSlug).filter(Boolean))
    })

    // Pairs dont un flux est annoncé (data channel) ou déjà en route (appel entrant).
    const announcedSlugs = computed(() => new Set(_read(api?.announcedStreamPeers)))

    // Intersection avec `remotePeers` : une annonce résiduelle d'un pair déjà parti ne
    // doit rien afficher, quel que soit l'ordre des purges.
    const awaitedPeers = computed(() =>
        _read(api?.remotePeers).filter(
            (slug) => slug
                && announcedSlugs.value.has(slug)
                && !streamingSlugs.value.has(slug)
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
    // que le flux arrive (ou que l'annonce tombe).
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

        // Désarme ce qui n'est plus attendu (flux reçu, annonce tombée, pair parti).
        ;[...timers.keys()]
            .filter((slug) => !slugs.includes(slug))
            .forEach(_clearTimer)
    }, { immediate: true })

    // Une annonce qui tombe remet l'ardoise à zéro : si le pair rediffuse (ou revient
    // dans la room), sa nouvelle annonce doit réafficher une vignette même si la
    // précédente attente avait expiré. Sans ça, un unique abandon rendait le pair
    // silencieux pour toute la session.
    watch(announcedSlugs, (slugs) => {
        const kept = abandoned.value.filter((slug) => slugs.has(slug))
        if (kept.length !== abandoned.value.length) {
            abandoned.value = kept
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
