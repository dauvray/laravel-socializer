# TODO — Front transverse (hors module)

> **Chantier ouvert, non démarré.** Petits items de lisibilité qui ne relèvent d'aucun module.
> Les faits durables correspondants sont déjà dans `docs/` — ce fichier ne porte que ce qui reste
> à faire.

## Nommage des directives de resize

Le suffixe décrit l'**orientation de la poignée**, pas l'axe redimensionné : `resizable_horizontal`
(poignée horizontale, `ns-resize`) redimensionne la **hauteur**, `resizable_vertical` (poignée
verticale, `ew-resize`) redimensionne la **largeur**. Contre-intuitif au point d'avoir fait conclure
à tort à un bug d'import dans `ChatComponent.vue` (27/05/2026) — il n'y en avait pas.

Le fait est consigné dans
[`docs/modules/chat.md`](../docs/modules/chat.md#composables-en-place-carte-rapide) ; reste à lever
l'ambiguïté à la source.

- [ ] Renommer `resizable_horizontal.js` → `resizable_height.js` et `resizable_vertical.js` →
      `resizable_width.js` dans `src/resources/js/socializer/directives/`.
      Impacte les imports de `ChatComponent.vue` (le messenger, via `--messenger-height`) et de
      `Server.vue` (la sidebar, via `el.style.width`).
- [ ] Alternative plus légère si le renommage est jugé trop invasif : un commentaire d'en-tête
      « poignée horizontale ⇒ resize vertical » dans chacun des deux fichiers.

## Deux whispers écrits en direct contre Echo, hors du composable (22/08/2026)

`useReverbChannel` compte désormais ses consommateurs par canal, parce que `me.channel` est partagé
par trois composants et qu'un `Echo.leave()` le coupait pour tous — le correctif et son incident
sont dans
[`docs/reference/use-reverb-channel.md`](../docs/reference/use-reverb-channel.md#un-canal-partagé-se-libère-au-compteur).

Deux appels échappent à ce compteur, tous deux dans un hook de démontage :

- `components/Chat/ChatComponent.vue:461` — `Echo.private(me.value.channel).whisper('leave-chat', …)`
- `components/Feed/Feed.vue:80` — `Echo.private(this.me.channel).whisper('leave-feed', …)`

Ils **fonctionnent aujourd'hui** : le shell `System/Server.vue` monte `Notifications.vue` en
permanence, donc le canal est toujours vivant et `Echo.private()` rend la souscription mémoïsée. Mais
sur un hôte qui n'aurait pas ce shell, le même appel **crée** une souscription que personne ne tient
au compteur et que personne ne libérera — à l'instant précis où le composant meurt.

- [ ] Router ces deux whispers par `useReverbChannel(meChannelName, { type: 'private' })`, comme
      `Server/Server.vue` et `Server/Room.vue`. `Feed.vue` est en Options API : soit le composable
      dans un `setup()`, soit un `try/catch` en attendant.
