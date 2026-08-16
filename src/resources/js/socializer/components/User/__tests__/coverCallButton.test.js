/**
 * coverCallButton.test.js
 *
 * C5 — le bouton d'appel du mur ne s'affiche que si le serveur autorise la relation.
 *
 * Avant : `v-if="user.connected"`. Depuis que les 5 routes de signalisation exigent une
 * relation (C2), un appel hors relation part en 403 — et comme aucun composable WebRTC2
 * n'inspecte le statut HTTP, l'utilisateur ne voit RIEN : ni appel, ni erreur. Un bouton qui
 * ne fait rien est pire que pas de bouton.
 *
 * ⚠️ Ce masquage est de l'UX, pas un contrôle : le serveur refuse de toute façon. Ce que ces
 * tests épinglent, c'est qu'on ne propose plus une action impossible — pas qu'on l'empêche.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Cover from '~socializer/components/User/Cover.vue'
import CallRemotePeerBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/CallRemotePeerBtn.vue'
import FollowButton from '~socializer/components/User/widgets/FollowButton.vue'

// Charge utile du mur telle que la produit `/wall/{slug}` : `connected` vient de la ressource
// d'estarter, `may_reach` du verdict `mayReach` posé par `Users::getGraphUser`.
const wallOwner = (overrides = {}) => ({
    id: 12,
    slug: 'bob',
    name: 'bob',
    is_me: false,
    nb_followers: 3,
    connected: 1,
    may_reach: true,
    ...overrides,
})

// `shallow` : les enfants ne sont pas montés, seulement stubés. C'est ce qui évite d'avoir à
// fournir les `inject` de CallRemotePeerBtn (AWN, eventBus) pour tester sa seule PRÉSENCE.
const mountCover = (user) => mount(Cover, { props: { user }, shallow: true })

const callButton = (wrapper) => wrapper.findComponent(CallRemotePeerBtn)

describe('Cover — affichage du bouton d\'appel', () => {

    it('affiche le bouton quand le pair est connecté ET joignable', () => {
        expect(callButton(mountCover(wallOwner())).exists()).toBe(true)
    })

    it('masque le bouton quand le serveur refuse la relation', () => {
        const wrapper = mountCover(wallOwner({ may_reach: false }))

        expect(callButton(wrapper).exists()).toBe(false)

        // Le masquage vise le bouton d'appel, pas la zone d'outils : s'abonner reste possible
        // sans relation — c'est même le chemin qui mène à l'appel.
        expect(wrapper.findComponent(FollowButton).exists()).toBe(true)
    })

    it('masque le bouton quand le verdict est absent de la charge utile', () => {
        // `may_reach` non défini n'est pas « autorisé par défaut » : une charge utile qui ne
        // porte pas le verdict ne prouve rien, et l'appel partirait en 403.
        const { may_reach, ...sansVerdict } = wallOwner()

        expect(callButton(mountCover(sansVerdict)).exists()).toBe(false)
    })

    it('masque le bouton quand le pair est déconnecté, même joignable', () => {
        expect(callButton(mountCover(wallOwner({ connected: 0 }))).exists()).toBe(false)
    })
})
