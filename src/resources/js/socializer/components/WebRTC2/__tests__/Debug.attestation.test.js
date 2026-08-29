/**
 * Debug.attestation.test.js — le panneau rend-il la mesure qui décide de `enforce` ?
 *
 * ⚠️ **CE FICHIER EXISTE POUR UNE RAISON QUI N'EST PAS ÉVIDENTE : sans lui, on livre un correctif
 * d'observabilité que rien n'observe.** `signaling.attestation.enforce` est faux par défaut, et sa
 * condition de bascule porte sur des compteurs que le store tenait déjà — mais qu'aucune source de
 * production ne lisait, `Debug.vue` compris, alors que le store l'affirmait. Un chiffre juste que
 * personne ne peut lire ne mesure rien, et aucune assertion sur le store ne l'aurait montré.
 *
 * L'autre moitié de la mesure est côté serveur (`PeerAttestationTest`, section « Journal ») et les
 * deux ne se lisent qu'ensemble : le journal voit tous les utilisateurs mais seulement les
 * attestations PRÉSENTÉES ; ces compteurs-ci voient tout ce qui entre, mais dans UN onglet.
 *
 * Contrôles de harnais (convention du paquet), mesurés le 2026-08-29 :
 *   - retirer le bloc « Corroboration d'identité » de `Debug.vue` rougit **5 cas** — le sixième,
 *     `n'affiche jamais l'attestation locale elle-même`, reste vert : un panneau vide n'affiche
 *     rien, donc il n'affiche pas l'attestation non plus. C'est le cas vert d'emblée du fichier, et
 *     c'est la mutation ci-dessous qui l'épingle ;
 *   - interpoler `peerStore.localPeerAttestation` au lieu de sa présence rougit **2 cas** — celui-là
 *     et `dit si MON onglet atteste`, qui attend le mot et non la chaîne.
 */
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import Debug from '~socializer/components/WebRTC2/Widgets/UI/Report/Debug.vue'

/**
 * Le strict nécessaire pour que le panneau se rende.
 *
 * `currentType: 'data'` et `topology: 'mesh'` écartent les deux blocs conditionnels (média, hub) :
 * ce fichier ne parle que de la corroboration d'identité, et monter les autres n'apporterait que
 * des stubs à maintenir.
 */
const api = () => ({
    contextId: 'ctx-1',
    onAirRoom: ref('room-1'),
    currentCallRoomId: ref(null),
    currentType: ref('data'),
    remotePeers: ref([]),
    presenceSynced: ref(true),
    topology: ref('mesh'),
    localPeerId: ref('peer-moi'),
})

const monter = (semis = {}) => {
    const peerStore = usePeer2Store()

    Object.assign(peerStore, semis)

    return { peerStore, wrapper: mount(Debug, { props: { api: api() } }) }
}

describe('Debug.vue — la mesure qui décide de la bascule d\'`enforce`', () => {

    it('rend les trois compteurs, et pas seulement celui de la décision', () => {
        const { wrapper } = monter({
            uncorroboratedAdmissions: 7,
            unattestedAdmissions: 5,
            unverifiableAdmissions: 2,
        })

        const texte = wrapper.text()

        expect(texte).toContain('Admissions non corroborées')
        expect(texte).toContain('7')
        expect(texte).toContain('5')
        expect(texte).toContain('2')
    })

    it('peint le compteur de décision en rouge dès qu\'il bouge, en vert à zéro', async () => {
        // L'idiome `stateClass` du fichier, et ici il porte la décision entière : vert veut dire
        // « rien ne serait refusé si l'on basculait maintenant ».
        const { wrapper } = monter({ uncorroboratedAdmissions: 0 })
        expect(wrapper.get('[data-role="uncorroborated"]').classes()).toContain('text-success')

        const bouge = monter({ uncorroboratedAdmissions: 1 })
        expect(bouge.wrapper.get('[data-role="uncorroborated"]').classes()).toContain('text-danger')
    })

    it('peint le compteur de non-vérifiables, parce qu\'un serveur muet invalide l\'autre moitié', () => {
        // Tant qu'il bouge, le silence du journal serveur ne prouve rien : il ne distingue pas
        // « aucun refus » de « aucune requête ».
        const { wrapper } = monter({ unverifiableAdmissions: 3 })

        expect(wrapper.get('[data-role="unverifiable"]').classes()).toContain('text-danger')
    })

    it('dit si MON onglet atteste, ce qui est l\'autre moitié de la question du déploiement mixte', () => {
        const sans = monter({ localPeerAttestation: null })
        expect(sans.wrapper.get('[data-role="local-attestation"]').text()).toContain('absente')

        const avec = monter({ localPeerAttestation: 'charge.signature' })
        expect(avec.wrapper.get('[data-role="local-attestation"]').text()).toContain('présente')
    })

    it('n\'affiche jamais l\'attestation locale elle-même', () => {
        // ⚠️ UNE IDENTITÉ SIGNÉE, valable jusqu'à son échéance. L'afficher la rendrait rejouable par
        // quiconque voit l'écran, une capture ou un partage de bureau — le panneau est justement là
        // pour être montré pendant un diagnostic. Le serveur applique la même règle à son journal
        // (`le_journal_ne_contient_jamais_l_attestation`) ; c'est la même règle des deux côtés.
        const { wrapper } = monter({ localPeerAttestation: 'charge-secrete.signature-secrete' })

        expect(wrapper.text()).not.toContain('charge-secrete')
        expect(wrapper.text()).not.toContain('signature-secrete')
    })

    it('rend la politique du serveur, parce qu\'un compteur ne se lit pas sans elle', () => {
        // Un compteur non nul sous `enforce: false` mesure une surface ; le même sous `true` compte
        // des pairs déjà refusés. Le même chiffre, deux faits.
        const { wrapper } = monter({ attestationEnforce: true })

        expect(wrapper.get('[data-role="attestation-enforce"]').text()).toContain('true')
    })
})
