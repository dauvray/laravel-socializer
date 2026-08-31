/**
 * useMediaBroadcast.watchUsers.test.js
 *
 * Le point d'entrée de la chaîne de présence : ce que le provider reçoit du canal Reverb
 * (`watch(() => props.users, api.watchUsers, { immediate: true })`) et ce qui descend, ou
 * non, vers `syncUsersConnections`.
 *
 * ⚠️ **Ce fichier mocke l'orchestrateur EN ENTIER, et c'est délibéré** : il épingle le seul
 * point d'entrée de la chaîne de présence, donc il ne doit rien savoir de ce qui vit en
 * dessous. Conséquence utile — il est insensible à l'endroit où vit la décision de routage
 * star, qui est descendue dans `usePeerTransport.routeIncomingData` sans toucher un cas ici.
 * Conséquence coûteuse, et c'est la contrepartie : **un double définit la surface**, donc
 * aucun cas de ce fichier ne peut voir une clé renommée en amont. C'est
 * `useMediaBroadcast.surface.test.js`, monté sur l'orchestrateur réel, qui tient ce contrat —
 * cf. `docs/architecture/tests.md`, « le 0 croisé décide du découpage en fichiers ».
 *
 * `useMediaBroadcast` n'enregistre aucun hook de lifecycle Vue (c'est une façade + trois
 * closures) : il s'appelle directement, sans `withSetup`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'

const orchestratorDouble = {
    syncUsersConnections: vi.fn(),
}

// Le double est déréférencé à l'APPEL, pas à l'import : la fabrique de `vi.mock` est
// hoistée au-dessus des déclarations du fichier, un `() => orchestratorDouble` direct
// lèverait en TDZ. Même idiome que `Notifications.test.js`.
vi.mock('~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js', () => ({
    usePeerOrchestrator: () => orchestratorDouble,
}))

describe('useMediaBroadcast.watchUsers', () => {
    let api

    beforeEach(() => {
        // ⚠️ On réinitialise le mock, on ne le REMPLACE pas : `useMediaBroadcast`
        // déstructure `syncUsersConnections` une fois pour toutes à la construction, et
        // sa closure garderait l'ancienne référence. Pour changer le comportement d'un
        // seul cas, `mockImplementationOnce` sur ce même mock — jamais une réaffectation.
        vi.clearAllMocks()
        api = useMediaBroadcast('data', 'room-1')
    })

    it('transmet la LISTE VIDE — c\'est le seul tour qui purge le dernier partant', () => {
        // ⭐ La régression à empêcher. Le garde retiré ici sortait sur `length === 0` : la
        // room qui se vide n'était jamais synchronisée, et ses membres restaient dans
        // `remotePeers`, c'est-à-dire dans l'allowlist des gardes d'autorisation.
        api.watchUsers([])

        expect(orchestratorDouble.syncUsersConnections).toHaveBeenCalledWith([])
    })

    it('transmet une composition non vide telle quelle', () => {
        const users = [{ slug: 'alice' }, { slug: 'bob' }]

        api.watchUsers(users)

        expect(orchestratorDouble.syncUsersConnections).toHaveBeenCalledWith(users)
    })

    it('transmet aussi null : la forme se valide à un seul endroit', () => {
        // `syncUsersConnections` rejette sur son `Array.isArray`. Dupliquer ce contrôle ici
        // ferait deux définitions de « liste valide », qui divergeraient.
        api.watchUsers(null)

        expect(orchestratorDouble.syncUsersConnections).toHaveBeenCalledWith(null)
    })

    it('journalise une levée synchrone au lieu de la propager au watcher', () => {
        // Le watcher du provider n'a pas de filet : une exception qui remonte casse le
        // flush du scheduler Vue. Portée réelle du try/catch : `syncUsersConnections` est
        // async et non attendue, donc seules les levées SYNCHRONES passent par ici.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        orchestratorDouble.syncUsersConnections.mockImplementationOnce(() => {
            throw new Error('boom')
        })

        expect(() => api.watchUsers([{ slug: 'alice' }])).not.toThrow()
        expect(consoleError).toHaveBeenCalled()

        consoleError.mockRestore()
    })
})
