/**
 * useCallStateMachine.test.js
 *
 * Tests unitaires de la machine d'état d'appel.
 * Aucune dépendance externe — seulement Vue ref/computed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    createCallStateMachine,
    CALL_STATES,
} from '~socializer/components/WebRTC2/Composables/utils/useCallStateMachine.js'

describe('createCallStateMachine', () => {
    let fsm

    beforeEach(() => {
        fsm = createCallStateMachine('test-ctx')
    })

    // ── État initial ────────────────────────────────────────────────────────

    describe('état initial', () => {
        it('démarre en état IDLE', () => {
            expect(fsm.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('callInprogress est false en état IDLE', () => {
            expect(fsm.callInprogress.value).toBe(false)
        })

        it('isStopping est false en état IDLE', () => {
            expect(fsm.isStopping.value).toBe(false)
        })

        it('closingUsers est un Set vide', () => {
            expect(fsm.closingUsers).toBeInstanceOf(Set)
            expect(fsm.closingUsers.size).toBe(0)
        })
    })

    // ── Transitions valides ─────────────────────────────────────────────────

    describe('transitions valides', () => {
        it('IDLE → CALLING', () => {
            expect(fsm.transition(CALL_STATES.CALLING)).toBe(true)
            expect(fsm.callState.value).toBe(CALL_STATES.CALLING)
        })

        it('IDLE → RECEIVING', () => {
            expect(fsm.transition(CALL_STATES.RECEIVING)).toBe(true)
            expect(fsm.callState.value).toBe(CALL_STATES.RECEIVING)
        })

        it('CALLING → CONNECTED', () => {
            fsm.transition(CALL_STATES.CALLING)
            expect(fsm.transition(CALL_STATES.CONNECTED)).toBe(true)
            expect(fsm.callState.value).toBe(CALL_STATES.CONNECTED)
        })

        it('CALLING → CLOSING', () => {
            fsm.transition(CALL_STATES.CALLING)
            expect(fsm.transition(CALL_STATES.CLOSING)).toBe(true)
            expect(fsm.callState.value).toBe(CALL_STATES.CLOSING)
        })

        it('CALLING → IDLE (refus direct)', () => {
            fsm.transition(CALL_STATES.CALLING)
            expect(fsm.transition(CALL_STATES.IDLE)).toBe(true)
            expect(fsm.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('RECEIVING → CONNECTED', () => {
            fsm.transition(CALL_STATES.RECEIVING)
            expect(fsm.transition(CALL_STATES.CONNECTED)).toBe(true)
        })

        it('RECEIVING → CLOSING', () => {
            fsm.transition(CALL_STATES.RECEIVING)
            expect(fsm.transition(CALL_STATES.CLOSING)).toBe(true)
        })

        it('RECEIVING → IDLE', () => {
            fsm.transition(CALL_STATES.RECEIVING)
            expect(fsm.transition(CALL_STATES.IDLE)).toBe(true)
        })

        it('CONNECTED → CLOSING', () => {
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CONNECTED)
            expect(fsm.transition(CALL_STATES.CLOSING)).toBe(true)
        })

        it('CLOSING → IDLE', () => {
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CLOSING)
            expect(fsm.transition(CALL_STATES.IDLE)).toBe(true)
        })

        it('chaîne complète IDLE→CALLING→CONNECTED→CLOSING→IDLE', () => {
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CONNECTED)
            fsm.transition(CALL_STATES.CLOSING)
            expect(fsm.transition(CALL_STATES.IDLE)).toBe(true)
            expect(fsm.callState.value).toBe(CALL_STATES.IDLE)
        })
    })

    // ── Transitions invalides ───────────────────────────────────────────────

    describe('transitions invalides', () => {
        it('IDLE → CONNECTED est refusé', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            expect(fsm.transition(CALL_STATES.CONNECTED)).toBe(false)
            expect(fsm.callState.value).toBe(CALL_STATES.IDLE)
            expect(warn).toHaveBeenCalled()
            warn.mockRestore()
        })

        it('IDLE → CLOSING est refusé', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            expect(fsm.transition(CALL_STATES.CLOSING)).toBe(false)
            expect(fsm.callState.value).toBe(CALL_STATES.IDLE)
            warn.mockRestore()
        })

        it('CONNECTED → CALLING est refusé', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CONNECTED)
            expect(fsm.transition(CALL_STATES.CALLING)).toBe(false)
            expect(fsm.callState.value).toBe(CALL_STATES.CONNECTED)
            warn.mockRestore()
        })

        it('CONNECTED → IDLE est refusé', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CONNECTED)
            expect(fsm.transition(CALL_STATES.IDLE)).toBe(false)
            warn.mockRestore()
        })

        it('CLOSING → CALLING est refusé', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CLOSING)
            expect(fsm.transition(CALL_STATES.CALLING)).toBe(false)
            warn.mockRestore()
        })

        it('une transition invalide ne modifie pas callState', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            fsm.transition(CALL_STATES.CLOSING) // invalide depuis IDLE
            expect(fsm.callState.value).toBe(CALL_STATES.IDLE)
            warn.mockRestore()
        })
    })

    // ── Computed dérivés ────────────────────────────────────────────────────

    describe('computed callInprogress', () => {
        it('est true dès qu\'un appel est en cours (CALLING)', () => {
            fsm.transition(CALL_STATES.CALLING)
            expect(fsm.callInprogress.value).toBe(true)
        })

        it('est true en RECEIVING', () => {
            fsm.transition(CALL_STATES.RECEIVING)
            expect(fsm.callInprogress.value).toBe(true)
        })

        it('est true en CONNECTED', () => {
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CONNECTED)
            expect(fsm.callInprogress.value).toBe(true)
        })

        it('est true en CLOSING', () => {
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CLOSING)
            expect(fsm.callInprogress.value).toBe(true)
        })

        it('repasse à false après reset()', () => {
            fsm.transition(CALL_STATES.CALLING)
            expect(fsm.callInprogress.value).toBe(true)
            fsm.reset()
            expect(fsm.callInprogress.value).toBe(false)
        })
    })

    describe('computed isStopping', () => {
        it('est false hors CLOSING', () => {
            fsm.transition(CALL_STATES.CALLING)
            expect(fsm.isStopping.value).toBe(false)
        })

        it('est true uniquement en CLOSING', () => {
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CLOSING)
            expect(fsm.isStopping.value).toBe(true)
        })
    })

    // ── canTransition ───────────────────────────────────────────────────────

    describe('canTransition', () => {
        it('retourne true pour une transition autorisée', () => {
            expect(fsm.canTransition(CALL_STATES.CALLING)).toBe(true)
        })

        it('retourne false pour une transition interdite', () => {
            expect(fsm.canTransition(CALL_STATES.CONNECTED)).toBe(false)
        })
    })

    // ── reset() ─────────────────────────────────────────────────────────────

    describe('reset()', () => {
        it('remet callState à IDLE depuis n\'importe quel état', () => {
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CONNECTED)
            fsm.reset()
            expect(fsm.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('vide closingUsers', () => {
            fsm.closingUsers.add('alice')
            fsm.closingUsers.add('bob')
            fsm.reset()
            expect(fsm.closingUsers.size).toBe(0)
        })

        it('mutex idempotent : deux transitions CLOSING consécutives (via reset) ne bloquent pas', () => {
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CLOSING)
            fsm.reset()
            // Après reset on peut repartir en CALLING
            expect(fsm.transition(CALL_STATES.CALLING)).toBe(true)
        })
    })

    // ── closingUsers ────────────────────────────────────────────────────────

    describe('closingUsers (garde par utilisateur)', () => {
        it('peut contenir plusieurs slugs simultanément', () => {
            fsm.closingUsers.add('alice')
            fsm.closingUsers.add('bob')
            expect(fsm.closingUsers.has('alice')).toBe(true)
            expect(fsm.closingUsers.has('bob')).toBe(true)
            expect(fsm.closingUsers.size).toBe(2)
        })

        it('est orthogonal à callState (n\'affecte pas callInprogress)', () => {
            fsm.transition(CALL_STATES.CALLING)
            fsm.transition(CALL_STATES.CONNECTED)
            fsm.closingUsers.add('alice')
            // closingUsers ne change pas callState
            expect(fsm.callState.value).toBe(CALL_STATES.CONNECTED)
        })
    })
})
