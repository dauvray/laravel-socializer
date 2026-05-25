// ─── Nom du Canal Reverb ───────────────────────────────────
/**
 * Symbole unique utilisé comme clé d'injection pour le canal Reverb partagé.
 * Les composants enfants peuvent injecter ce canal pour envoyer/recevoir des messages
 * de présence et de signalisation en temps réel.
 * Exemple d'injection : const reverb = inject(REVERB_CHANNEL)
 */
export const REVERB_CHANNEL = Symbol('reverbChannel')