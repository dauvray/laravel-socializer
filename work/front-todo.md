# TODO — Front transverse (hors module)

> **Chantier ouvert.** Items front qui ne relèvent d'aucun module. Les faits durables
> correspondants sont déjà dans `docs/` — ce fichier ne porte que ce qui reste à faire.

## Deux whispers écrits en direct contre Echo, hors du composable (22/08/2026)

`useReverbChannel` compte désormais ses consommateurs par canal, parce que `me.channel` est partagé
par trois composants et qu'un `Echo.leave()` le coupait pour tous — le correctif et son incident
sont dans
[`docs/reference/use-reverb-channel.md`](../docs/reference/use-reverb-channel.md#un-canal-partagé-se-libère-au-compteur).

Deux appels échappent à ce compteur, tous deux dans un hook de démontage :

- `components/Chat/ChatComponent.vue` — `Echo.private(me.value.channel).whisper('leave-chat', …)`
- `components/Feed/Feed.vue` — `Echo.private(this.me.channel).whisper('leave-feed', …)`

Ils **fonctionnent aujourd'hui** : le shell `System/Server.vue` monte `Notifications.vue` en
permanence, donc le canal est toujours vivant et `Echo.private()` rend la souscription mémoïsée. Mais
sur un hôte qui n'aurait pas ce shell, le même appel **crée** une souscription que personne ne tient
au compteur et que personne ne libérera — à l'instant précis où le composant meurt.

- [ ] Router ces deux whispers par `useReverbChannel(meChannelName, { type: 'private' })`, comme
      `Server/Server.vue` et `Server/Room.vue`. `Feed.vue` est en Options API : soit le composable
      dans un `setup()`, soit un `try/catch` en attendant.
