# TODO — Front transverse (hors module)

> **Chantier ouvert.** Items front qui ne relèvent d'aucun module. Les faits durables
> correspondants sont déjà dans `docs/` — ce fichier ne porte que ce qui reste à faire.

## Le ping d'ouverture de session court contre la confirmation d'abonnement (26/08/2026)

Les quatre whispers de départ et le battement de présence passent désormais tous par
`useReverbChannel` — la contrainte d'ordre qui les fait partir est dans
[`docs/reference/use-reverb-channel.md`](../docs/reference/use-reverb-channel.md#un-whisper-de-départ-senregistre-avant-le-composable),
épinglée par deux `describe` de `components/System/composables/__tests__/useReverbChannel.test.js`.

Reste une course **antérieure et indépendante**, trouvée en vérifiant ce routage.

`System/Notifications.vue` whispere `ping` depuis un `watch(me)` placé sous l'appel au composable :
le `join()` passe donc bien en premier. Mais **joindre n'est pas être abonné.** `Echo.private(name)`
rend l'objet canal tout de suite ; pusher, lui, confirme l'abonnement par un aller-retour. Entre les
deux, `Channel.trigger` journalise `Client event triggered before channel 'subscription_succeeded'`
et **émet quand même** — et Reverb rejette un client event sur un canal non confirmé.

Ce que ça coûte quand la course est perdue : le ping d'ouverture ne compte pas, et l'utilisateur
n'apparaît en ligne qu'au battement suivant. Or l'intervalle du heartbeat (120 000 ms,
`Notifications.vue`) **égale** le TTL Redis de la présence (`now()->addMinutes(2)`,
`app/Services/OnlineUsersService.php`) : il n'y a aucune marge, la fenêtre est de deux minutes
pleines.

Le piège à connaître avant d'y toucher : **`PusherChannel.subscribed(cb)` est un écouteur
d'événement, pas une promesse.** Branché après coup sur un canal déjà confirmé, le rappel ne part
**jamais** — un correctif naïf transformerait une course perdue une fois sur deux en ping jamais
émis. Il faut tester l'état d'abord, puis s'abonner.

- [ ] Faire partir le ping d'ouverture **à** la confirmation d'abonnement, en gardant le cas
      déjà-confirmé. Deux voies : un `channel()?.subscribed(…)` gardé côté `Notifications.vue`, ou
      une option `onSubscribed` dans `useReverbChannel` — la seconde profiterait aux quatre autres
      consommateurs et éviterait de rouvrir l'échappatoire `channel()`.
- [ ] **La vérification est sur un vrai Reverb**, pas en test : aucune doublure ne prouve un
      aller-retour d'abonnement. Se connecter, et regarder si l'utilisateur apparaît en ligne
      immédiatement ou au bout de deux minutes.
