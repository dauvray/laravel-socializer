# `useReverbChannel` — Documentation

> **À quoi ça sert :** la référence d'API du composable de canaux Reverb — signature, options,
> valeurs de retour, et les pièges du cycle de vie partagé.
> **Quand le lire :** avant de souscrire un canal, d'ajouter un whisper, ou de soupçonner une fuite
> de souscription.

Composable Vue 3 permettant de gérer simplement les canaux **Laravel Reverb / Echo** (public, privé, présence, chiffré) au sein d'un composant, avec gestion automatique du cycle de vie, des listeners, des notifications et des *whispers*.

---

## Sommaire

1. [Prérequis](#prérequis)
2. [Installation et import](#installation-et-import)
3. [Vue d'ensemble](#vue-densemble)
4. [Référence API](#référence-api)
   - [Signature](#signature)
   - [Options](#options)
   - [Valeurs retournées](#valeurs-retournées)
5. [Les 4 types de canaux](#les-4-types-de-canaux)
6. [Exemples, sur les canaux réellement déclarés](#exemples-sur-les-canaux-réellement-déclarés)
   - [Présence : la liste est dédoublonnée, pas le signal](#présence--la-liste-est-dédoublonnée-pas-le-signal)
7. [Patterns avancés](#patterns-avancés)
   - [Nom de canal réactif](#nom-de-canal-réactif)
   - [Listeners dynamiques](#listeners-dynamiques)
   - [Whispers (events client)](#whispers-events-client)
   - [Notifications Laravel](#notifications-laravel)
   - [Contrôle manuel du cycle de vie](#contrôle-manuel-du-cycle-de-vie)
   - [Un canal partagé se libère au compteur](#un-canal-partagé-se-libère-au-compteur)
   - [Un whisper de départ s'enregistre AVANT le composable](#un-whisper-de-départ-senregistre-avant-le-composable)
   - [Un whisper émis depuis un watcher s'enregistre APRÈS le composable](#un-whisper-émis-depuis-un-watcher-senregistre-après-le-composable)
   - [Gestion d'erreurs](#gestion-derreurs)
   - [Accès au canal natif Echo](#accès-au-canal-natif-echo)
8. [`useReverbPresence` — sucre syntaxique](#usereverbpresence--sucre-syntaxique)
9. [Pièges courants](#pièges-courants)

---

## Prérequis

- **Vue 3** (Composition API)
- **Laravel Echo** initialisé et exposé globalement comme `window.Echo` **par le projet hôte** — le paquet n'en fournit aucun amorçage, et le fichier qui s'en charge varie d'un hôte à l'autre
- **Laravel Reverb** (ou Pusher-compatible) configuré côté backend
- Les routes de canaux correctement déclarées pour les canaux privés / présence / chiffrés — dans ce paquet, `src/routes/socializer/channels.php` ([signalisation.md](../architecture/signalisation.md))

> ⚠️ Le composable suppose que `Echo` est disponible globalement. Si vous l'importez localement, adaptez le fichier en ajoutant un `import Echo from 'laravel-echo'`.

---

## Installation et import

Le composable vit dans le paquet, à
`src/resources/js/socializer/components/System/composables/useReverbChannel.js` — donc importé par
l'alias `~socializer`, jamais en relatif ni par un autre alias
([conventions.md](../architecture/conventions.md)).

```js
// Dans n'importe quel composant Vue 3
import { useReverbChannel, useReverbPresence } from '~socializer/components/System/composables/useReverbChannel.js'
```

---

## Vue d'ensemble

```js
const { isConnected, users, error, listen, whisper, leave } = useReverbChannel(
  `chat.${chatId}`,
  {
    type: 'presence',
    listeners: {
      '.MessageSent': (e) => console.log('Nouveau message', e),
    },
    onHere:    (users) => console.log('Utilisateurs présents', users),
    onJoining: (u) => console.log(`${u.name} a rejoint`),
    onLeaving: (u) => console.log(`${u.name} a quitté`),
  }
)
```

Le composable s'occupe automatiquement :

- de **rejoindre** le canal au montage (`autoJoin: true` par défaut),
- de **quitter** proprement le canal à la destruction du composant (`onBeforeUnmount`),
- de **rebrancher** tous les listeners lors d'un changement de nom de canal réactif,
- de **réappliquer** les listeners ajoutés dynamiquement après une reconnexion.

---

## Référence API

### Signature

```ts
useReverbChannel(channelName, options?)
```

| Paramètre     | Type                              | Obligatoire | Description |
|---------------|-----------------------------------|-------------|-------------|
| `channelName` | `string \| Ref<string>`           | ✅          | Nom du canal Echo. Peut être réactif. |
| `options`     | `Object`                          | ❌          | Voir ci-dessous. |

### Options

| Option            | Type                                                 | Défaut      | Description |
|-------------------|------------------------------------------------------|-------------|-------------|
| `type`            | `'public' \| 'private' \| 'presence' \| 'encrypted'` | `'public'`  | Type du canal. |
| `listeners`       | `Record<string, Function>`                           | `{}`        | Listeners statiques. Les clés sont les noms d'événements (préfixés `.` si broadcast de classe Laravel non-namespacée). |
| `whispers`        | `Record<string, Function>`                           | `{}`        | Listeners pour les *client events* (ex. : indicateurs de frappe). |
| `onNotification`  | `Function`                                           | `null`      | Callback pour les notifications Laravel (canaux privés / présence). |
| `onHere`          | `Function`                                           | `null`      | **Presence** : appelé une fois avec la liste initiale des utilisateurs présents. |
| `onJoining`       | `Function`                                           | `null`      | **Presence** : appelé lorsqu'un utilisateur rejoint. Appelé **à chaque annonce, doublon compris** — voir [Présence : la liste est dédoublonnée, pas le signal](#présence--la-liste-est-dédoublonnée-pas-le-signal). |
| `onLeaving`       | `Function`                                           | `null`      | **Presence** : appelé lorsqu'un utilisateur quitte. |
| `onError`         | `Function`                                           | `null`      | Callback en cas d'erreur du canal. |
| `autoJoin`        | `boolean`                                            | `true`      | Si `false`, vous devez appeler `join()` manuellement. ⚠️ **Il conditionne aussi la réactivité du nom de canal** : le `watch` sur `channelName` n'est enregistré que si `autoJoin` est vrai. Avec `autoJoin: false`, un nom réactif ne rebascule jamais. |

### Valeurs retournées

| Clé             | Type                                  | Description |
|-----------------|---------------------------------------|-------------|
| `users`         | `Ref<Array>`                          | Liste des utilisateurs présents (canal de présence uniquement), **dédoublonnée par `id`**. |
| `isConnected`   | `Ref<boolean>`                        | ⚠️ **Optimiste hors présence.** Sur `presence`, il attend `here()`. Sur `public`, `private` et `encrypted`, il est posé `true` **synchronement après la fabrique**, avant toute confirmation d'abonnement — donc il ne prouve rien avant d'émettre un whisper. |
| `error`         | `Ref<any>`                            | Dernière erreur reçue, le cas échéant. |
| `join()`        | `() => void`                          | Rejoint manuellement le canal. |
| `leave()`       | `() => void`                          | Quitte le canal. Appelé automatiquement au démontage. |
| `listen(event, cb)` | `(string, Function) => void`      | Ajoute un listener dynamique. Persiste à travers les reconnexions. |
| `stopListening(event)` | `(string) => void`             | ⚠️ Appelle le `stopListening` d'Echo : coupe **tous** les handlers de cet event, y compris ceux déclarés dans `options.listeners`. Le retrait est donc **durable** pour un listener dynamique et **temporaire** pour un statique, que le prochain re-join réapplique. |
| `listenForWhisper(event, cb)` | `(string, Function) => void` | Écoute un *client event*. Persiste à travers les reconnexions — c'est ce qui évite de passer par `channel().listenForWhisper()`. |
| `stopListeningForWhisper(event)` | `(string) => void`      | Symétrique de `listenForWhisper`. |
| `whisper(event, payload)` | `(string, any) => boolean`  | Émet un *client event* (whisper). Rend `false` — **sans jamais lever** — si la souscription n'est plus vivante. |
| `channel()`     | `() => EchoChannel \| null`           | Retourne l'instance Echo brute (échappatoire). |

---

## Les 4 types de canaux

| Type        | Méthode Echo               | Authentifié | Cas d'usage |
|-------------|----------------------------|-------------|-------------|
| `public`    | `Echo.channel()`           | ❌          | Annonces globales, notifications publiques. |
| `private`   | `Echo.private()`           | ✅          | Notifications utilisateur, données privées. |
| `presence`  | `Echo.join()`              | ✅          | Liste de personnes en ligne, chat de groupe. |
| `encrypted` | `Echo.encryptedPrivate()`  | ✅ (E2E)    | Données sensibles, chiffrement bout-en-bout. |

---

## Exemples, sur les canaux réellement déclarés

Le paquet déclare **cinq** canaux, tous dans `src/routes/socializer/channels.php` :
`App.Models.User.{userId}` (privé, le `me.channel` du store), `chat.{chatId}`, `room.{roomId}`,
`server.{serverId}` et `questionnaire.{roomId}`. Aucun n'est public, aucun n'est chiffré — les deux
types restants sont supportés par le composable, pas employés ici.

**Privé** — le canal personnel, celui qui porte les notifications et la signalisation WebRTC2 :

```vue
<script setup>
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'
import { useMeStore } from '~socializer/stores/socialUser.js'

const me = useMeStore()

useReverbChannel(me.channel, {
  type: 'private',
  listeners: {
    '.AskToPeerID': (payload) => { /* … */ },
  },
})
</script>
```

⚠️ **`me.channel` se souscrit par le composable, jamais par un `Echo.private()` écrit à la main.**
Cinq composants le tiennent aujourd'hui, dont un qui ne se démonte jamais : seul le compteur de
consommateurs (§ « Un canal partagé se libère au compteur ») empêche qu'une fermeture locale coupe
les autres. Un `Echo.private()` direct **crée** une souscription hors compteur que personne ne
libérera — c'est bénin tant que la coquille SPA tient le canal, et c'est une fuite dès qu'un hôte
n'a pas cette coquille.

**Présence** — `room.{roomId}` et `server.{serverId}` sont des canaux de présence : c'est d'eux que
vient la liste des personnes connectées.

```vue
<script setup>
const { users } = useReverbChannel(`room.${props.roomId}`, {
  type: 'presence',
  onJoining: (user) => { /* admission d'un pair WebRTC2 */ },
  onLeaving: (user) => { /* … */ },
})
</script>
```

**Public et chiffré** — `type: 'public'` mappe `Echo.channel()`, `type: 'encrypted'` mappe
`Echo.encryptedPrivate()`. Le second exige une configuration Reverb dédiée. Aucun canal du paquet
n'en fait usage aujourd'hui : les employer suppose d'en déclarer un dans `channels.php` d'abord.

### Présence : la liste est dédoublonnée, pas le signal

**pusher-js n'émet pas `member_added` de façon idempotente.** Son `addMember()` protège son propre
hash (`if (this.get(user_id) === null) this.count++`) mais fait partir l'`emit` dans tous les cas.
Un `member_added` reçu pour quelqu'un déjà présent ferait donc compter la même personne deux fois —
`users.length` affiche 2 là où une seule est connectée.

Deux chemins produisent ce doublon : un redémarrage de Reverb pendant qu'un client se souscrit, et
`REVERB_SCALING_ENABLED` avec plus d'un process, où le garde anti-doublon de Reverb
(`InteractsWithPresenceChannels::userIsSubscribed`) ne consulte que les connexions de **son**
process.

Le composable pose donc une garde sur `id` avant d'ajouter à `users`. Ce qu'il **ne** fait pas, et
c'est volontaire :

> **`onJoining` est appelé à chaque annonce, doublon compris.** Le chemin présence de WebRTC2 s'en
> sert pour l'admission des pairs ; l'étouffer corrigerait un compteur en cassant une poignée de
> main. On dédoublonne la liste, jamais le signal.

Épinglé par `components/System/composables/__tests__/useReverbChannel.test.js`.

Corollaire côté affichage : `users` porte des `PresenceUser`, **six champs et rien d'autre**
(`id`, `name`, `slug`, `image`, `function`, `connected`). Pas de `is_me` — le store `me` est le seul
juge de « moi » ici —, et rien de ce qu'une charge utile HTTP porte en plus (`identifier`,
`may_reach`, `groups`). Le pourquoi :
[architecture/signalisation.md](../architecture/signalisation.md#une-charge-utile-de-présence-est-fabriquée-par-son-propre-sujet).

---

## Patterns avancés

### Nom de canal réactif

Le composable observe `channelName` : si vous passez un `ref` ou un `computed`, il quitte l'ancien canal et rejoint le nouveau automatiquement.

```vue
<script setup>
import { ref, computed } from 'vue'
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

const currentRoomId = ref(1)
const channelName = computed(() => `room.${currentRoomId.value}`)

useReverbChannel(channelName, {
  type: 'presence',
  listeners: {
    '.MessageSent': (e) => console.log(e),
  },
})

// Changer de salon → quitte l'ancien, rejoint le nouveau, listeners reconnectés
const switchRoom = (id) => { currentRoomId.value = id }
</script>
```

> 💡 Les listeners statiques (option `listeners`) ET les listeners dynamiques (ajoutés via `listen()`) sont automatiquement réappliqués sur le nouveau canal.

---

### Listeners dynamiques

Utile lorsque vous voulez ajouter / retirer des listeners en cours de vie du composant (par exemple en fonction des actions de l'utilisateur).

```vue
<script setup>
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

const { listen, stopListening } = useReverbChannel('feed', { type: 'public' })

const enableLikesTracking = () => {
  listen('.MessageSent', (e) => console.log('Like reçu', e))
}

const disableLikesTracking = () => {
  stopListening('.MessageSent')
}
</script>
```

> 💡 Les listeners ajoutés via `listen()` sont **persistants** : ils survivent à un changement de nom de canal (reconnexion automatique).

---

### Whispers (events client)

Les *whispers* permettent de diffuser un évènement directement entre clients, sans passer par le serveur Laravel. Idéal pour les indicateurs de frappe, le curseur partagé, etc.

```vue
<script setup>
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

const { whisper } = useReverbChannel(`chat.${props.chatId}`, {
  type: 'presence',
  whispers: {
    'typing': ({ userId }) => {
      // Affiche « untel est en train d'écrire »
    },
  },
})

const onInput = () => {
  whisper('typing', { userId: me.id })
}
</script>

<template>
  <textarea @input="onInput" />
</template>
```

> ⚠️ Les whispers ne sont disponibles que sur les canaux **privés**, **présence** ou **chiffrés** (ils nécessitent l'authentification).

---

### Notifications Laravel

Le canal privé / présence d'un utilisateur (`App.Models.User.{id}`) reçoit ses notifications Laravel via `notification()`. Le composable expose cela via l'option `onNotification`.

```vue
<script setup>
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

useReverbChannel(`App.Models.User.${window.userId}`, {
  type: 'private',
  onNotification: (notification) => {
    console.log('Type :', notification.type)
    console.log('Données :', notification)
    // Ex : afficher un toast
  },
})
</script>
```

---

### Contrôle manuel du cycle de vie

Si vous souhaitez déclencher le `join` plus tard (après chargement d'un user, ouverture d'une modale, etc.), désactivez `autoJoin`.

```vue
<script setup>
import { ref } from 'vue'
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

const showChat = ref(false)

const { join, leave, isConnected } = useReverbChannel(`chat.${props.chatId}`, {
  type: 'private',
  autoJoin: false,
  listeners: {
    '.MessageSent': (e) => console.log(e),
  },
})

const openChat = () => {
  showChat.value = true
  join()
}

const closeChat = () => {
  leave()
  showChat.value = false
}
</script>
```

> ⚠️ Même avec `autoJoin: false`, **`leave()` est appelé automatiquement** à `onBeforeUnmount`.

---

### Un canal partagé se libère au compteur

**Echo mémoïse ses canaux par nom.** Deux `useReverbChannel('user.7', …)` dans deux composants
différents partagent donc **un** objet canal et **une** souscription pusher — mais `Echo.leave()`,
lui, la coupe pour tout le monde. Le cas n'est pas théorique : `Notifications.vue`, `Server.vue`,
`Room.vue`, `ChatComponent.vue` et `Feed.vue` souscrivent tous les cinq au canal privé `me.channel`.

Le composable tient donc un **compteur de consommateurs par nom de canal** : `leave()` retire les
handlers du partant, et n'appelle `Echo.leave()` que si plus personne ne tient le canal. Deux
conséquences à connaître :

- **Un `leave()` peut ne rien fermer** — c'est voulu. Vérifier une fermeture effective se fait côté
  Reverb (`GET /apps/{id}/channels/…`), pas en comptant les appels à `leave()`.
- **La clé du compteur est le nom NU**, sans préfixe de type : `Echo.leave(name)` détruit `name`,
  `private-name` **et** `presence-name` d'un seul geste. Son rayon d'action est celui du nom.

Ce que ça a corrigé : naviguer d'une room vers une autre page affichait la **nouvelle URL sur
l'ancien écran**. `Server.vue` (parent) libérait `me.channel` en se démontant, puis `Room.vue`
(enfant, démonté juste après) y whisperait `leave-room` — `PusherPrivateChannel.whisper()`
déréférence `pusher.channels.channels[name]` sans garde, donc `TypeError` dans un hook de
démontage, que Vue relance **au milieu du flush du scheduler** : le patch avorte, la vue ne change
jamais. Le même `Echo.leave()` intempestif privait aussi `Notifications.vue`, resté monté, de ses
notifications temps réel jusqu'au rechargement de la page.

D'où le second garde-fou, indépendant : **`whisper()` ne lève jamais** et rend `false` quand le
whisper n'est pas parti. Un client event perdu est un incident bénin ; il ne doit pas coûter une
navigation.

Épinglé par `components/System/composables/__tests__/useReverbChannel.test.js`.

---

### Un whisper de départ s'enregistre AVANT le composable

Quatre composants préviennent de leur départ par un whisper posé dans un hook de démontage :
`leave-server`, `leave-room`, `leave-chat`, `leave-feed`. Côté serveur, `UserOnlineWhisperListener`
en fait un `removeUserItem(…)` — **un whisper perdu laisse une présence fantôme que rien n'efface.**

Or `useReverbChannel` enregistre son propre `onBeforeUnmount(leave)` **au moment de l'appel**, et
Vue exécute les hooks de démontage dans leur ordre d'**enregistrement**. D'où la règle, qui porte
sur un ordre de lignes que ni type ni lint ne protègent :

```js
// S'exécute avant le leave() auto enregistré par le useReverbChannel ci-dessous.
onBeforeUnmount(() => {
    whisperMe('leave-chat', { chatId: …, userId: … })
})

const { whisper: whisperMe } = useReverbChannel(meChannelName, { type: 'private' })
```

Le `const` lu par une closure déclarée au-dessus est **volontaire** : elle ne le lit qu'au
démontage. Inverser les deux blocs ne casse rien de visible — `leave()` a simplement déjà révoqué
la souscription, `whisper()` rend `false`, et **rien ne le signale** puisqu'il ne lève jamais.

⚠️ **Corollaire Options API :** `applyOptions()` tourne **après** `setup()`, donc un
`beforeUnmount()` d'options part **après** tous les hooks de `setup()`. Un whisper laissé là serait
perdu. C'est pourquoi `Feed/Feed.vue`, resté en Options API, porte quand même son câblage Reverb
dans un `setup()`.

Les trois cas — l'ordre correct, l'ordre inversé, et le composant mixte `setup()` + options — sont
épinglés par `components/System/composables/__tests__/useReverbChannel.test.js`.

➡️ **Un whisper qui ne part pas d'un hook de démontage obéit à l'ordre INVERSE** — § suivant. Ne pas
appliquer celui-ci par analogie.

---

### Un whisper émis depuis un watcher s'enregistre APRÈS le composable

**L'ordre inverse du précédent, et c'est la même règle.** Elle ne porte pas sur « avant » ou
« après » mais sur une seule exigence : *quand le whisper part, le composable doit avoir joint et
pas encore libéré.* Deux mécanismes en découlent, symétriques :

| Le whisper part depuis… | Il s'enregistre… | Parce que le composable y enregistre… |
|---|---|---|
| un hook de démontage | **avant** l'appel | son `onBeforeUnmount(leave)` — les hooks partent dans l'ordre d'enregistrement |
| un watcher | **après** l'appel | son `watch(channelName)` qui joint — les watchers partent dans l'ordre de création |

Le cas vivant est `System/Notifications.vue`, qui whispere son battement de présence (`ping`) depuis
un `watch(me)` :

```js
const { whisper: whisperPing } = useReverbChannel(userChannel, { type: 'private', … })

// APRÈS l'appel : sur le flush où `me` arrive, le join() du composable doit passer en premier.
watch(me, (value) => {
    if (value) setOnlineStatus()
})
```

Ce n'est pas théorique : `me` est **null au montage** — `loadMe()` est asynchrone et le composant ne
l'attend pas —, donc la transition `null → valeur` a toujours lieu, et les deux watchers y
réagissent dans le même flush. Le watcher au-dessus de l'appel, `whisper()` rend `false` et
l'utilisateur reste hors ligne jusqu'au battement suivant : deux minutes, soit exactement le TTL
Redis de la présence.

Les deux cas sont épinglés par le même fichier de test.

⚠️ **Joindre n'est pas être abonné.** `Echo.private(name)` rend l'objet canal tout de suite, mais
pusher confirme l'abonnement par un aller-retour, et Reverb rejette un client event émis avant. Un
whisper émis juste après le `join()` est donc encore une course — ouverte, et suivie dans
[`work/front-todo.md`](../../work/front-todo.md).

---

### Gestion d'erreurs

```vue
<script setup>
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

const { error } = useReverbChannel(`server.${props.serverId}`, {
  type: 'private',
  onError: (err) => {
    // Ex : redirection si 403, toast d'erreur, etc.
    if (err.status === 403) router.push('/forbidden')
  },
})
</script>

<template>
  <div v-if="error" class="alert">
    Impossible de rejoindre le canal : {{ error.status }}
  </div>
</template>
```

---

### Accès au canal natif Echo

Pour les cas non couverts par l'API du composable, la fonction `channel()` retourne l'objet Echo brut.

```js
const { channel } = useReverbChannel('test', { type: 'private' })

// Accès aux méthodes natives d'Echo
channel()?.subscribed(() => console.log('Souscrit !'))
```

---

## `useReverbPresence` — sucre syntaxique

Raccourci équivalent à `useReverbChannel(name, { type: 'presence', ...rest })`.

```js
import { useReverbPresence } from '~socializer/components/System/composables/useReverbChannel.js'

const { users, isConnected } = useReverbPresence(`room.${props.roomId}`, {
  listeners: {
    '.MessageSent': (e) => console.log(e),
  },
  onJoining: (u) => console.log(`${u.name} rejoint`),
})
```

---

## Pièges courants

| Symptôme                                    | Cause probable                                          | Solution |
|---------------------------------------------|---------------------------------------------------------|----------|
| Aucun event reçu                            | Oubli du `.` devant le nom de l'event                   | `'.MessageSent'` au lieu de `'MessageSent'` |
| Erreur 403 sur canal privé                  | Déclaration manquante dans `src/routes/socializer/channels.php`, ou autorisation refusée | Vérifier la déclaration et la closure d'auth |
| `users` reste vide                          | Le type n'est pas `presence`                            | Passer `type: 'presence'` |
| Un membre compté deux fois                  | Un `member_added` en double — pusher-js ne les dédoublonne pas | Déjà gardé par le composable ; si le doublon revient, chercher un `id` absent de la charge utile du canal |
| « 2 présents alors que je suis seul »        | Le plus souvent **vrai** : la présence compte les onglets. Un onglet d'arrière-plan sur la même page est « présent » ; être connecté ailleurs dans l'app ne compte pas | Interroger Reverb : `GET /apps/{id}/channels/presence-{canal}/users` avant de soupçonner le front |
| Un champ attendu absent de `users`          | La présence porte une `PresenceUser` : six champs en liste blanche, pas la ressource HTTP | Lire le champ sur l'endpoint HTTP concerné ; sur `is_me`, comparer avec le store `me` |
| Whisper ignoré                              | Canal public utilisé                                    | Les whispers nécessitent private / presence / encrypted |
| L'URL change, l'écran reste sur la page précédente | Une exception levée dans un `onBeforeUnmount` avorte le flush de Vue — typiquement un `whisper` sur une souscription déjà libérée | Le composable ne lève plus (`whisper` rend `false`) ; si le symptôme revient, chercher l'exception dans les autres hooks de démontage de la route quittée |
| Notifications temps réel muettes après avoir quitté une page | Un composant a libéré un canal **partagé** avec un autre encore monté | Souscrire via le composable (compteur de consommateurs), jamais par un `Echo.leave()` écrit à la main |
| Whisper de départ jamais reçu — présence fantôme côté serveur, l'utilisateur reste « dans » un chat/feed qu'il a quitté | Le hook qui whispere est enregistré **après** l'appel au composable, ou dans le `beforeUnmount()` d'un composant Options API : `leave()` est déjà passé, `whisper()` rend `false` en silence | L'enregistrer **avant** l'appel — [§ Un whisper de départ s'enregistre AVANT le composable](#un-whisper-de-départ-senregistre-avant-le-composable) |
| L'utilisateur n'apparaît en ligne que deux minutes après s'être connecté | Le watcher qui whispere le `ping` est créé **avant** l'appel au composable : le `join()` n'a pas encore eu lieu, `whisper()` rend `false` | Le créer **après** — [§ Un whisper émis depuis un watcher s'enregistre APRÈS le composable](#un-whisper-émis-depuis-un-watcher-senregistre-après-le-composable). Si l'ordre est bon et le symptôme demeure, c'est la course d'abonnement : [`work/front-todo.md`](../../work/front-todo.md) |
| Listeners perdus après changement de canal  | Listener ajouté manuellement via `channel().listen()`    | Utiliser `listen()` du composable (persistant) |
| `Echo is not defined`                       | Echo non exposé globalement                             | Vérifier que l'hôte fait bien `window.Echo = new Echo(...)` — le paquet ne l'initialise pas |
| Double abonnement                           | `join()` appelé deux fois sans `leave()`                | Le composable filtre déjà si `currentName === newName` ; vérifier le code applicatif |

---