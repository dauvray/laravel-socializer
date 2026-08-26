/**
 * serverConnectionLabel.test.js
 *
 * Épingle le **vocabulaire** du compteur de `ServerParamsButton`, pas son mécanisme.
 *
 * Le compteur affiche les souscriptions au canal de présence `server.{id}` — donc des onglets
 * ouverts, arrière-plan compris. Il était juste et il l'est resté ; c'est le mot « présent » qui
 * mentait, au point d'avoir fait prendre un compteur correct pour un bug (21/08/2026). L'arbitrage
 * produit a été tranché en faveur du comportement actuel, le libellé étant le seul défaut :
 * `docs/architecture/signalisation.md#ce-que-la-présence-mesure--un-onglet-ouvert`.
 *
 * ⚠️ Ce sont des tests d'UX, pas des gardes : rien ici n'empêche quoi que ce soit. Ce qu'ils
 * empêchent, c'est que le libellé recommence à promettre de l'activité là où il y a une connexion.
 *
 * **Contrôle de harnais effectué** (règle 4, et règle 5 pour les assertions négatives) : les six
 * libellés remis à leur forme « présent/présente/présentes » d'avant — les quatre cas de
 * `connectionLabel` et l'en-tête du dropdown rougissent. La nuance « un onglet ouvert suffit » est
 * portée par un seul point de code (`withNuance`), donc un seul mécanisme à neutraliser.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { getActivePinia } from 'pinia'
import { useMeStore } from '~estarter/stores/me.js'
import ServerParamsButton from '~socializer/components/Server/widgets/ServerParamsButton.vue'

const ME_ID = 7

/** Une `PresenceUser` telle que `channels.php` la produit : six champs, et rien d'autre. */
const presenceUser = (id, name) => ({
    id,
    name,
    slug: name,
    image: null,
    function: null,
    connected: 1,
})

/**
 * `shallow` : les enfants (`IconWidget`, `ServerUsersList`) sont stubés — on teste les libellés
 * de CE composant. Le reste du harnais tient à ce que `ServerParamsButton` consomme :
 *
 * - **la pinia active est passée en plugin**, pas seulement laissée active. `mapState` lit
 *   `this.$pinia` : sans le plugin, il retombe sur l'instance globale en émettant un warning de
 *   render, et le test serait vert par un chemin de repli plutôt que par l'injection réelle.
 * - `router-link` est stubé explicitement — il n'est pas enregistré localement, donc `shallow` ne
 *   le couvre pas ; et son `:to` lit `$route.params`, d'où le mock de route.
 * - `AWN` est `inject` par le composant (il ne sert qu'à la confirmation de suppression).
 * - `vertexid` est renseigné pour que `isOwner` tranche `false` sans lever : `getOwnerId` rend
 *   `null` sur un store vide, et comparer `null` à `undefined` n'asserte rien d'utile ici.
 */
const mountButton = (serverUsers = []) => {
    useMeStore().user = { id: ME_ID, vertexid: 'v-me' }

    return mount(ServerParamsButton, {
        props: {
            server: { id: 3, name: 'Atelier' },
            serverUsers,
        },
        shallow: true,
        global: {
            plugins: [getActivePinia()],
            provide: { AWN: {} },
            stubs: { 'router-link': true },
            mocks: { $route: { params: { serverId: 3 } } },
        },
    })
}

const tooltip = (wrapper) => wrapper.find('.server-users button').attributes('title')

describe('ServerParamsButton — ce que le compteur dit compter', () => {

    it('ne prononce jamais le mot « présent », ni dans le chiffre ni dans son infobulle', () => {
        const wrapper = mountButton([
            presenceUser(ME_ID, 'moi'),
            presenceUser(9, 'bob'),
        ])

        // Le mensonge visé est le mot lui-même : il ne doit rester ni dans le texte rendu
        // (en-tête du dropdown) ni dans l'attribut title, seuls libellés lus par un humain.
        expect(wrapper.text()).not.toMatch(/présent/i)
        expect(tooltip(wrapper)).not.toMatch(/présent/i)
    })

    it('nomme la borne au lieu de la laisser deviner : un onglet ouvert suffit', () => {
        const wrapper = mountButton([presenceUser(9, 'bob')])

        expect(tooltip(wrapper)).toContain('un onglet ouvert suffit à être compté')
    })

    it('compte les souscriptions passées, sans les filtrer', () => {
        const wrapper = mountButton([
            presenceUser(ME_ID, 'moi'),
            presenceUser(9, 'bob'),
            presenceUser(11, 'carole'),
        ])

        expect(wrapper.find('.server-users button').text()).toContain('3')
        expect(tooltip(wrapper)).toBe(
            'Vous et 2 autres personnes connectées à ce serveur — un onglet ouvert suffit à être compté'
        )
    })

    it('distingue « vous » des autres, et le cas où je suis seul', () => {
        expect(tooltip(mountButton([presenceUser(ME_ID, 'moi')]))).toBe(
            'Vous êtes seul connecté à ce serveur — un onglet ouvert suffit à être compté'
        )

        expect(tooltip(mountButton([presenceUser(ME_ID, 'moi'), presenceUser(9, 'bob')]))).toBe(
            'Vous et 1 autre personne connectée à ce serveur — un onglet ouvert suffit à être compté'
        )
    })

    it('ne parle pas de « vous » quand la liste ne me contient pas encore', () => {
        // La souscription peut être établie et le `here` de Reverb pas encore arrivé pour moi.
        // Annoncer « vous et N autres » y serait faux — c'est le juge `me` qui tranche, jamais
        // un `is_me` de charge utile (il valait `true` pour tout le monde, cf. ServerUsersList).
        const wrapper = mountButton([presenceUser(9, 'bob'), presenceUser(11, 'carole')])

        expect(tooltip(wrapper)).toBe(
            '2 personnes connectées à ce serveur — un onglet ouvert suffit à être compté'
        )
    })

    it("n'affirme pas le vide quand la liste est vide : zéro veut dire « pas encore synchronisé »", () => {
        // On est TOUJOURS dans sa propre liste de présence dès que la souscription tient. Donc
        // zéro ne signifie pas « personne » : ce cas-là est celui de l'attente du `here`, et
        // c'est le seul libellé du composant qui ne parle pas d'un décompte.
        const wrapper = mountButton([])

        expect(tooltip(wrapper)).toBe('Connexion en cours…')
        expect(tooltip(wrapper)).not.toMatch(/personne/i)
        expect(wrapper.text()).not.toMatch(/personne n'est/i)
    })
})
