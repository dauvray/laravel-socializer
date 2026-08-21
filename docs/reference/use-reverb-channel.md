# `useReverbChannel` — Documentation

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
6. [Exemples par type de canal](#exemples-par-type-de-canal)
   - [Canal public](#1-canal-public)
   - [Canal privé](#2-canal-privé)
   - [Canal de présence](#3-canal-de-présence)
   - [Présence : la liste est dédoublonnée, pas le signal](#présence--la-liste-est-dédoublonnée-pas-le-signal)
   - [Canal chiffré](#4-canal-chiffré)
7. [Patterns avancés](#patterns-avancés)
   - [Nom de canal réactif](#nom-de-canal-réactif)
   - [Listeners dynamiques](#listeners-dynamiques)
   - [Whispers (events client)](#whispers-events-client)
   - [Notifications Laravel](#notifications-laravel)
   - [Contrôle manuel du cycle de vie](#contrôle-manuel-du-cycle-de-vie)
   - [Gestion d'erreurs](#gestion-derreurs)
   - [Accès au canal natif Echo](#accès-au-canal-natif-echo)
8. [`useReverbPresence` — sucre syntaxique](#usereverbpresence--sucre-syntaxique)
9. [Bonnes pratiques](#bonnes-pratiques)
10. [Pièges courants](#pièges-courants)

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
  'chat.room.42',
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
| `autoJoin`        | `boolean`                                            | `true`      | Si `false`, vous devez appeler `join()` manuellement. |

### Valeurs retournées

| Clé             | Type                                  | Description |
|-----------------|---------------------------------------|-------------|
| `users`         | `Ref<Array>`                          | Liste des utilisateurs présents (canal de présence uniquement), **dédoublonnée par `id`**. |
| `isConnected`   | `Ref<boolean>`                        | `true` lorsque le canal est rejoint avec succès. |
| `error`         | `Ref<any>`                            | Dernière erreur reçue, le cas échéant. |
| `join()`        | `() => void`                          | Rejoint manuellement le canal. |
| `leave()`       | `() => void`                          | Quitte le canal. Appelé automatiquement au démontage. |
| `listen(event, cb)` | `(string, Function) => void`      | Ajoute un listener dynamique. Persiste à travers les reconnexions. |
| `stopListening(event)` | `(string) => void`             | Supprime tous les listeners dynamiques pour cet event. |
| `whisper(event, payload)` | `(string, any) => void`     | Émet un *client event* (whisper). |
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

## Exemples par type de canal

### 1. Canal public

Idéal pour les diffusions ouvertes (annonces du site, mises à jour de cours en temps réel, etc.).

#### Backend (Laravel)

```php
// app/Events/AnnouncementPosted.php
class AnnouncementPosted implements ShouldBroadcast
{
    public function broadcastOn(): Channel
    {
        return new Channel('announcements');
    }
}
```

#### Frontend (Vue 3)

```vue
<script setup>
import { ref } from 'vue'
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

const announcements = ref([])

useReverbChannel('announcements', {
  type: 'public',
  listeners: {
    '.AnnouncementPosted': (event) => {
      announcements.value.unshift(event)
    },
  },
})
</script>

<template>
  <ul>
    <li v-for="a in announcements" :key="a.id">{{ a.title }}</li>
  </ul>
</template>
```

---

### 2. Canal privé

Pour des données réservées à un utilisateur authentifié (ex. : notifications personnelles, mises à jour d'une commande).

#### Backend

```php
// src/routes/socializer/channels.php (dans ce paquet)
Broadcast::channel('orders.{orderId}', function ($user, $orderId) {
    return $user->id === Order::find($orderId)->user_id;
});
```

```php
// app/Events/OrderStatusUpdated.php
class OrderStatusUpdated implements ShouldBroadcast
{
    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("orders.{$this->order->id}");
    }
}
```

#### Frontend

```vue
<script setup>
import { ref } from 'vue'
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

const props = defineProps({ orderId: { type: Number, required: true } })
const status = ref('pending')

useReverbChannel(`orders.${props.orderId}`, {
  type: 'private',
  listeners: {
    '.OrderStatusUpdated': (e) => { status.value = e.status },
  },
  onError: (err) => console.error('Auth canal échouée', err),
})
</script>

<template>
  <div>Statut commande : <strong>{{ status }}</strong></div>
</template>
```

---

### 3. Canal de présence

Le plus riche : permet de connaître la liste des utilisateurs présents, qui rejoint, qui part. Parfait pour un chat de groupe ou une page collaborative.

#### Backend

```php
// src/routes/socializer/channels.php (dans ce paquet)
Broadcast::channel('room.{roomId}', function ($user, $roomId) {
    if ($user->canAccessRoom($roomId)) {
        return ['id' => $user->id, 'name' => $user->name, 'avatar' => $user->avatar];
    }
});
```

```php
// Diffusion d'un message
class MessageSent implements ShouldBroadcast
{
    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel("room.{$this->roomId}");
    }
}
```

#### Frontend — chat collaboratif complet

```vue
<script setup>
import { ref } from 'vue'
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

const props = defineProps({ roomId: { type: Number, required: true } })
const messages = ref([])
const typingUsers = ref(new Set())

const { users, isConnected, whisper } = useReverbChannel(`room.${props.roomId}`, {
  type: 'presence',

  // Liste statique des events « serveur » à écouter
  listeners: {
    '.MessageSent': (e) => messages.value.push(e),
  },

  // Whispers : events « client » (pas de round-trip serveur)
  whispers: {
    typing: ({ userId, name }) => {
      typingUsers.value.add(name)
      setTimeout(() => typingUsers.value.delete(name), 2000)
    },
  },

  // Présence
  onHere:    (list) => console.log('Présents au démarrage :', list),
  onJoining: (u)    => console.log(`${u.name} a rejoint`),
  onLeaving: (u)    => {
    console.log(`${u.name} est parti`)
    typingUsers.value.delete(u.name)
  },
})

const sendTyping = () => {
  whisper('typing', { userId: window.userId, name: window.userName })
}
</script>

<template>
  <aside>
    <h3>En ligne ({{ users.length }})</h3>
    <ul>
      <li v-for="u in users" :key="u.id">
        <img :src="u.avatar" :alt="u.name" /> {{ u.name }}
      </li>
    </ul>
  </aside>

  <main>
    <p v-if="!isConnected">Connexion…</p>

    <div class="messages">
      <div v-for="m in messages" :key="m.id">
        <strong>{{ m.author }} :</strong> {{ m.body }}
      </div>
    </div>

    <p v-if="typingUsers.size">
      {{ [...typingUsers].join(', ') }} en train d'écrire…
    </p>

    <input @input="sendTyping" placeholder="Tapez un message" />
  </main>
</template>
```

---

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

Corollaire côté affichage : `users` porte des `UserResource` dont **`is_me` vaut `true` pour toutes
les entrées** — voir
[architecture/signalisation.md](../architecture/signalisation.md#une-charge-utile-de-présence-est-fabriquée-par-son-propre-sujet).

---

### 4. Canal chiffré

Identique au canal privé mais avec chiffrement de bout en bout (nécessite la configuration côté Reverb).

```vue
<script setup>
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

useReverbChannel(`secure.user.${window.userId}`, {
  type: 'encrypted',
  listeners: {
    '.SensitiveDataReceived': (payload) => {
      // payload est automatiquement déchiffré par Echo
      console.log('Données sécurisées', payload)
    },
  },
})
</script>
```

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
  listen('.PostLiked', (e) => console.log('Like reçu', e))
}

const disableLikesTracking = () => {
  stopListening('.PostLiked')
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

const { whisper } = useReverbChannel('doc.42', {
  type: 'presence',
  whispers: {
    'cursor-move': ({ userId, x, y }) => {
      // Met à jour la position du curseur d'un autre utilisateur
    },
  },
})

const onMouseMove = (e) => {
  whisper('cursor-move', { userId: window.userId, x: e.clientX, y: e.clientY })
}
</script>

<template>
  <div @mousemove="onMouseMove" class="document">…</div>
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

const { join, leave, isConnected } = useReverbChannel('support.live', {
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

### Gestion d'erreurs

```vue
<script setup>
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

const { error } = useReverbChannel('admin.metrics', {
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

const { users, isConnected } = useReverbPresence('room.lobby', {
  listeners: {
    '.UserMessage': (e) => console.log(e),
  },
  onJoining: (u) => console.log(`${u.name} rejoint`),
})
```

---

## Bonnes pratiques

1. **Préfixez les events `.`** lorsque l'event est une classe Laravel non-namespacée : `'.MessageSent'`. Sans le point, Echo cherche un event avec namespace `App\Events\`.
2. **Centralisez les noms de canaux** dans des helpers ou des constantes pour éviter les fautes de frappe :
   ```js
   export const roomChannel = (id) => `room.${id}`
   ```
3. **Préférez l'option `listeners`** pour les events connus à l'avance ; réservez `listen()` aux ajouts conditionnels.
4. **Utilisez `useReverbPresence`** quand le type est évident pour gagner en lisibilité.
5. **Throttle / debounce les whispers** (`cursor-move`, `typing`) côté émetteur : un event par mouvement de souris saturera le canal.
6. **Vérifiez `isConnected`** avant d'émettre des whispers ou d'afficher la liste d'utilisateurs.

---

## Pièges courants

| Symptôme                                    | Cause probable                                          | Solution |
|---------------------------------------------|---------------------------------------------------------|----------|
| Aucun event reçu                            | Oubli du `.` devant le nom de l'event                   | `'.MessageSent'` au lieu de `'MessageSent'` |
| Erreur 403 sur canal privé                  | Déclaration manquante dans `src/routes/socializer/channels.php`, ou autorisation refusée | Vérifier la déclaration et la closure d'auth |
| `users` reste vide                          | Le type n'est pas `presence`                            | Passer `type: 'presence'` |
| Un membre compté deux fois                  | Un `member_added` en double — pusher-js ne les dédoublonne pas | Déjà gardé par le composable ; si le doublon revient, chercher un `id` absent de la charge utile du canal |
| « 2 présents alors que je suis seul »        | Le plus souvent **vrai** : la présence compte les onglets. Un onglet d'arrière-plan sur la même page est « présent » ; être connecté ailleurs dans l'app ne compte pas | Interroger Reverb : `GET /apps/{id}/channels/presence-{canal}/users` avant de soupçonner le front |
| `is_me` vrai pour tout le monde             | Charge utile de présence fabriquée par son propre sujet | Comparer avec le store `me`, jamais `user.is_me` |
| Whisper ignoré                              | Canal public utilisé                                    | Les whispers nécessitent private / presence / encrypted |
| Listeners perdus après changement de canal  | Listener ajouté manuellement via `channel().listen()`    | Utiliser `listen()` du composable (persistant) |
| `Echo is not defined`                       | Echo non exposé globalement                             | Vérifier que l'hôte fait bien `window.Echo = new Echo(...)` — le paquet ne l'initialise pas |
| Double abonnement                           | `join()` appelé deux fois sans `leave()`                | Le composable filtre déjà si `currentName === newName` ; vérifier le code applicatif |

---