/**
 * usePeerMedia.players.test.js
 *
 * Couvre le pool d'instances Vue pour les players (cf. TODOLIST P2).
 *
 * La propriété centrale : `removeVideoElement` ne démonte PAS l'instance, il libère
 * son slot ; le flux suivant recycle cette instance. On le vérifie en comptant les
 * mounted/unmounted d'un stub de MediaBroadcastPlayer — c'est exactement ce que
 * l'ancienne implémentation (createApp + app.unmount par flux) faisait exploser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { usePeerMedia } from '~socializer/components/WebRTC2/Composables/usePeerMedia.js'
import { createMockContext } from './helpers/createMockContext.js'

// Compteurs partagés avec la factory de mock (hoistée au-dessus des imports)
const counters = vi.hoisted(() => ({ mounted: 0, unmounted: 0 }))

vi.mock('~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue', async () => {
    const { h, onUnmounted } = await import('vue')
    return {
        default: {
            name: 'MediaBroadcastPlayerStub',
            props: ['streamData', 'videoId', 'nickname', 'type', 'peer', 'roomId', 'resizable', 'draggable'],
            setup(props) {
                counters.mounted++
                onUnmounted(() => { counters.unmounted++ })
                return () => h(
                    'div',
                    {
                        class: 'player-stub',
                        // Le player réel n'affiche QUE `streamData.metadata` : on l'expose
                        // ici pour vérifier que le pool le transmet bien.
                        'data-from-name': props.streamData?.metadata?.fromName ?? '',
                    },
                    props.videoId ?? ''
                )
            },
        },
    }
})

const CONTAINER = '#videoContainer'

const hostElements = () => document.querySelectorAll('.webrtc2-player-host')
const slotElements = () => document.querySelectorAll('.webrtc2-player-host > div')
const visibleSlots = () =>
    [...slotElements()].filter((el) => el.style.display !== 'none')

const fakeStream = (id = 'stream') => ({
    id,
    getTracks: () => [],
})

describe('usePeerMedia — pool de players', () => {
    let ctx
    let media

    beforeEach(() => {
        counters.mounted = 0
        counters.unmounted = 0
        document.body.innerHTML = '<div id="videoContainer"></div>'
        ctx = createMockContext({ session: { currentType: 'visio', currentRoom: 'room-1' } })
        media = usePeerMedia(ctx)
    })

    afterEach(() => {
        document.body.innerHTML = ''
    })

    describe('acquire', () => {
        it('monte une seule app hôte et rend le player du flux', async () => {
            await media.createVideoElement({ videoId: 'local-webcam', type: 'visio' }, fakeStream())
            await nextTick()

            expect(hostElements()).toHaveLength(1)
            expect(counters.mounted).toBe(1)
            expect(document.getElementById('wrapper-local-webcam')).not.toBeNull()
            expect(ctx.peerStore.addPlayer).toHaveBeenCalledWith({
                videoId: 'local-webcam',
                type: 'visio',
            })
        })

        /**
         * Régression : le slot forçait `metadata: {}`. Les seules infos transmises
         * (nickname, peer, roomId) ne sont pas des props déclarées du player — elles
         * retombaient en attributs HTML. Résultat : tout flux passé par le pool
         * s'affichait « Inconnu », compteur d'audience à 0.
         */
        it("transmet au player les métadonnées du flux", async () => {
            await media.createVideoElement(
                { videoId: 'remote-alice-visio', metadata: { fromName: 'Alice', isMe: false } },
                fakeStream()
            )
            await nextTick()

            expect(document.querySelector('.player-stub').dataset.fromName).toBe('Alice')
        })

        it("repart d'un slot vierge quand une instance est recyclée", async () => {
            await media.createVideoElement(
                { videoId: 'remote-alice-visio', metadata: { fromName: 'Alice' } },
                fakeStream('a')
            )
            await nextTick()
            media.removeVideoElement('remote-alice-visio')
            await nextTick()

            await media.createVideoElement({ videoId: 'remote-bob-visio' }, fakeStream('b'))
            await nextTick()

            expect(counters.mounted).toBe(1) // même instance réutilisée
            expect(document.querySelector('.player-stub').dataset.fromName).toBe('')
        })

        it('ignore un videoId absent', async () => {
            await media.createVideoElement({}, fakeStream())
            await nextTick()

            expect(hostElements()).toHaveLength(0)
            expect(counters.mounted).toBe(0)
        })

        it('ignore un second acquire sur un videoId déjà attribué', async () => {
            await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream('a'))
            await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream('b'))
            await nextTick()

            expect(slotElements()).toHaveLength(1)
            expect(counters.mounted).toBe(1)
        })

        it("ne monte qu'un hôte pour des créations concurrentes sur le même container", async () => {
            await Promise.all([
                media.createVideoElement({ videoId: 'remote-alice-visio' }, fakeStream('a')),
                media.createVideoElement({ videoId: 'remote-bob-visio' }, fakeStream('b')),
            ])
            await nextTick()

            expect(hostElements()).toHaveLength(1)
            expect(slotElements()).toHaveLength(2)
            expect(counters.mounted).toBe(2)
        })

        it('rejette si le container est introuvable', async () => {
            document.body.innerHTML = ''

            await expect(
                media.createVideoElement({ videoId: 'local-webcam' }, fakeStream())
            ).rejects.toThrow(/introuvable/)
        })

        it("retente le montage après un échec de container (l'échec n'est pas mis en cache)", async () => {
            document.body.innerHTML = ''
            await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream()).catch(() => {})

            document.body.innerHTML = '<div id="videoContainer"></div>'
            await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream())
            await nextTick()

            expect(hostElements()).toHaveLength(1)
            expect(counters.mounted).toBe(1)
        })
    })

    describe('release', () => {
        it("libère le slot sans démonter l'instance", async () => {
            await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream())
            await nextTick()

            media.removeVideoElement('local-webcam')
            await nextTick()

            expect(counters.unmounted).toBe(0)          // ⬅️ le cœur du pool
            expect(slotElements()).toHaveLength(1)      // le slot reste dans le pool
            expect(visibleSlots()).toHaveLength(0)      // …mais masqué
            expect(document.getElementById('wrapper-local-webcam')).toBeNull()
            expect(ctx.peerStore.removePlayer).toHaveBeenCalledWith('local-webcam')
        })

        it('est un no-op sur un videoId inconnu', async () => {
            await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream())
            await nextTick()
            ctx.peerStore.removePlayer.mockClear()

            expect(() => media.removeVideoElement('remote-jamais-vu')).not.toThrow()
            expect(ctx.peerStore.removePlayer).not.toHaveBeenCalled()
            expect(visibleSlots()).toHaveLength(1)
        })

        it('est un no-op sans videoId', () => {
            expect(() => media.removeVideoElement(null)).not.toThrow()
            expect(ctx.peerStore.removePlayer).not.toHaveBeenCalled()
        })
    })

    describe('recyclage', () => {
        it("réutilise l'instance libérée pour le flux suivant", async () => {
            await media.createVideoElement({ videoId: 'remote-alice-visio' }, fakeStream('a'))
            await nextTick()
            media.removeVideoElement('remote-alice-visio')
            await nextTick()

            await media.createVideoElement({ videoId: 'remote-bob-visio' }, fakeStream('b'))
            await nextTick()

            expect(counters.mounted).toBe(1)        // aucune nouvelle instance
            expect(counters.unmounted).toBe(0)
            expect(slotElements()).toHaveLength(1)
            expect(document.getElementById('wrapper-remote-bob-visio')).not.toBeNull()
        })

        it('le pool grandit jusqu\'au pic de flux simultanés, pas au cumul', async () => {
            // 5 cycles join/leave successifs, jamais plus de 2 flux à la fois
            for (let i = 0; i < 5; i++) {
                await media.createVideoElement({ videoId: `remote-user${i}-visio` }, fakeStream(`s${i}`))
                await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream('local'))
                await nextTick()

                media.removeVideoElement(`remote-user${i}-visio`)
                media.removeVideoElement('local-webcam')
                await nextTick()
            }

            expect(counters.mounted).toBe(2)        // pic = 2 → 2 instances au total
            expect(counters.unmounted).toBe(0)
            expect(slotElements()).toHaveLength(2)
            expect(visibleSlots()).toHaveLength(0)
        })

        it('remet à zéro les données du slot libéré', async () => {
            await media.createVideoElement(
                { videoId: 'remote-alice-visio', type: 'visio', nickname: 'Alice' },
                fakeStream('a')
            )
            await nextTick()
            media.removeVideoElement('remote-alice-visio')
            await nextTick()

            const idle = slotElements()[0]
            expect(idle.querySelector('.player-stub').textContent).toBe('')
        })
    })

    describe('cleanupCallPlayers', () => {
        it("ne libère que les players d'appel", async () => {
            await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream('l'))
            await media.createVideoElement({ videoId: 'remote-alice-visio' }, fakeStream('a'))
            await media.createVideoElement({ videoId: 'screen-share' }, fakeStream('s'))
            await nextTick()

            media.cleanupCallPlayers()
            await nextTick()

            expect(visibleSlots()).toHaveLength(1)
            expect(document.getElementById('wrapper-screen-share')).not.toBeNull()
            expect(counters.unmounted).toBe(0)
        })
    })

    describe('destroyPlayers', () => {
        it('démonte les hôtes et retire leurs points de montage', async () => {
            await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream('l'))
            await media.createVideoElement({ videoId: 'remote-alice-visio' }, fakeStream('a'))
            await nextTick()

            await media.destroyPlayers()
            await nextTick()

            expect(counters.unmounted).toBe(2)
            expect(hostElements()).toHaveLength(0)
            expect(document.querySelector('#videoContainer').children).toHaveLength(0)
        })

        it('remonte un hôte neuf si un flux revient après destruction', async () => {
            await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream('l'))
            await nextTick()
            await media.destroyPlayers()

            await media.createVideoElement({ videoId: 'local-webcam' }, fakeStream('l2'))
            await nextTick()

            expect(hostElements()).toHaveLength(1)
            expect(counters.mounted).toBe(2)
            expect(document.getElementById('wrapper-local-webcam')).not.toBeNull()
        })
    })
})
