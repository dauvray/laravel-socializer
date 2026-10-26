// ─── Nom du Canal Reverb ───────────────────────────────────
/**
 * Symbole unique utilisé comme clé d'injection pour le canal Reverb partagé.
 * Les composants enfants peuvent injecter ce canal pour envoyer/recevoir des messages
 * de présence et de signalisation en temps réel.
 * Exemple d'injection : const reverb = inject(REVERB_CHANNEL)
 */
export const REVERB_CHANNEL = Symbol('reverbChannel')
// ─── Chargement des alertes d'appel ───────────────────────
/**
 * Délai au-delà duquel une alerte d'appel dont le chunk ne répond pas est tenue pour introuvable,
 * donc refusée d'office — `timeout` des deux `defineAsyncComponent` de la chaîne d'alerte
 * (`Notifications` → `AlertComponent` → l'alerte).
 *
 * ⚠️ Un `errorComponent` seul ne couvre que le chunk qui REJETTE. Un import qui pend — proxy qui
 * retient la requête, réseau qui tombe en plein fetch — n'atteint le composant d'erreur que par ce
 * délai : sans lui, il garderait le créneau d'alerte pour la vie de l'onglet, comme un 404.
 *
 * ⚠️ **La borne porte sur la CHAÎNE, pas sur la constante.** Les deux niveaux sont en série — le
 * wrapper interne ne naît qu'au rendu d'`AlertComponent` —, donc le pire cas est 2 × ce délai, puis
 * l'auto-refus de l'alerte vocale (20 s). Le tout doit tenir sous l'abandon du retry de l'appelant
 * (≈ 55 s : `usePeerRetry`, 8 tentatives à min(1000·2ⁿ, 10 000) ms), faute de quoi il ne lirait plus
 * le refus : 2T + 20 s < ≈ 55 s, soit **T < ≈ 17 s**. À 10 s, la chaîne fait 40 s.
 * Aligné sur l'auto-refus de l'alerte vidéo — personne n'attend une sonnerie plus longtemps.
 */
export const ALERT_LOAD_TIMEOUT_MS = 10_000
