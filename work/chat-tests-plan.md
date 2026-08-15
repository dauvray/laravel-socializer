# Chat — Plan de tests unitaires

> **Chantier ouvert, non démarré.** Un seul fichier de test existe
> (`dateSeparatorRender.test.js`). L'infra de tests du package est décrite dans
> [`docs/architecture/tests.md`](../docs/architecture/tests.md) ; les invariants à épingler dans
> [`docs/modules/chat.md`](../docs/modules/chat.md).

> Infrastructure : vitest 2.1.9 · @vue/test-utils 2.4 · happy-dom
> Config partagée : `/vitest.config.js` (alias `~`, `~estarter`, `~socializer`)
> Le glob `include` couvre déjà `socializer/**/__tests__/**/*.test.js` → tout fichier
> `*.test.js` placé ici est ramassé automatiquement.
> Commande : `npm run test:run` (ou `npm test` en watch)

---

## Stratégie

ChatComponent a été **refactoré en composables** (cf. [`docs/modules/chat.md`](../docs/modules/chat.md)). On teste donc
de bas en haut, du plus pur au plus intégré — chaque couche isolée est rentable et stable,
le composant n'est testé en montage complet qu'à la fin.

```
Couche 0 → utils/dateSeparator        (fonction pure, zéro Vue)
Couche 1 → useFileAttachments         (ref only, DOM minimal — composable partagé)
Couche 2 → useTypingIndicator         (logique pure, deps injectées)
Couche 3 → useChatScroll              (onMounted/watch/onUnmounted + DOM + timers)
Couche 4 → ChatComponent.vue          (montage + câblage : stores, Echo, router, eventBus)
```

Principe repris de WebRTC2 : **une conversation par tâche**, prérequis explicites,
cases à cocher mises à jour au fil de l'eau.

---

## ⚠️ Infrastructure à compléter avant la Couche 4

Le `setup.js` global (`../../WebRTC2/__tests__/setup.js`, référencé par `vitest.config.js`)
fournit Pinia frais + mocks navigateur, mais **pas `Echo`** (global Laravel) ni `vue-router`.
Avant la tâche de montage du composant, prévoir des helpers locaux `__tests__/helpers/` :

- [ ] **`mockEcho.js`** : stub global `Echo` (`Echo.join`, `Echo.private().whisper`,
  `Echo.channel`, `Echo.leave`). `useReverbPresence` appelle `Echo.join(name)` ;
  `onBeforeUnmount` appelle `Echo.private(me.channel).whisper('leave-chat', …)`.
- [ ] **`mockRoute.js`** (ou `vi.mock('vue-router')`) : `useRoute()` → `{ params: { vertexId } }`.
- [ ] **`seedChatStore.js`** : helper pour peupler `useChatStore` / `useMeStore` (Pinia réel,
  state injecté) — privilégier le store réel seedé à un `vi.mock` complet, plus proche du runtime.
- [ ] Réutiliser tel quel **`helpers/withSetup.js`** et **`helpers/mockEventBus.js`** de WebRTC2
  pour les composables (Couches 1-3) qui touchent `inject`/lifecycle.

> Décision à acter : helpers Chat dédiés sous `Chat/__tests__/helpers/` **ou** promotion des
> helpers WebRTC2 vers un dossier partagé. Par défaut : dédiés à Chat (couplage faible).

---

## Avancement

- [ ] Couche 0 — `dateSeparator.test.js`
- [ ] Couche 1 — `useChatAttachments.test.js`
- [ ] Couche 2 — `useTypingIndicator.test.js`
- [ ] Couche 3 — `useChatScroll.test.js`
- [ ] Couche 4 — `ChatComponent.test.js` (+ helpers infra ci-dessus)

---

### Couche 0 — `dateSeparator.test.js` (fonction pure)

**Périmètre** : `utils/dateSeparator.js` → `shouldShowDateSeparator(messages, index, displaySeparator)`.
Aucun import Vue, aucun mock. Test le plus rentable, à faire en premier.

- [ ] `displaySeparator === false` → retourne `false` quel que soit l'index
- [ ] `index === 0` → toujours `true` (premier message)
- [ ] deux messages le **même jour** (heures différentes) → `false` sur le second
- [ ] deux messages à des **jours différents** → `true` sur le second
- [ ] passage minuit (`23:59` puis `00:01` lendemain) → `true` (comparaison sur `toDateString`)
- [ ] `displaySeparator` par défaut (omis) = `true`

**Prérequis** : aucun.

---

### Couche 1 — `useChatAttachments.test.js`

**Périmètre** : `composables/useChatAttachments.js` → `attachedFiles`, `onFileAdded`,
`removeFromList`, `clear`. Pas de lifecycle Vue → appel direct possible (sans `withSetup`).

- [ ] état initial : `attachedFiles` = tableau vide
- [ ] `onFileAdded(file)` : pousse l'élément **et** affecte `file.preview` via `URL.createObjectURL(file.data)`
- [ ] `onFileAdded` x2 : les deux fichiers coexistent dans la liste
- [ ] `removeFromList({ id })` : retire l'entrée d'`id` correspondant, laisse les autres
- [ ] `removeFromList` avec un id absent : liste inchangée (pas d'erreur)
- [ ] `clear()` : vide la liste

**Prérequis** : mocker `URL.createObjectURL` (`vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x') })`
ou `vi.spyOn`). happy-dom peut ne pas l'implémenter.

---

### Couche 2 — `useTypingIndicator.test.js`

**Périmètre** : `composables/useTypingIndicator.js`. Logique pure, `currentUser` et `whisper`
injectés en dépendances → appel direct (pas de lifecycle).

**Réception (`onTypingWhisper`)**
- [ ] `isTyping: true` d'un **autre** user → ajouté à `actors`
- [ ] `isTyping: false` → retiré d'`actors`
- [ ] whisper de **soi-même** (`userId === currentUser.id`) → ignoré (pas dans `actors`)
- [ ] payload sans `userId` → ignoré, pas de crash
- [ ] réactivité : `actors` (computed) se met bien à jour après `set`/`delete` (`touchReactivity`)

**Émission (`startWriting` / `stopWriting`)**
- [ ] `startWriting` → `whisper('typing', { userId, name, isTyping: true })`
- [ ] `stopWriting` → `whisper('typing', { …, isTyping: false })`
- [ ] `currentUser` absent (`unref` → null) → aucun whisper émis, pas de crash
- [ ] `currentUser` passé comme **ref** ET comme objet plat → les deux fonctionnent (`unref`)

**Acteurs explicites (Agent Bot)**
- [ ] `addActorWriting('Agent Bot')` → présent dans `actors`
- [ ] `addActorWriting` deux fois le même nom → pas de doublon
- [ ] `removeActorWriting('Agent Bot')` → retiré
- [ ] **déduplication** : un user nommé « Agent Bot » via whisper + acteur manuel « Agent Bot »
  n'apparaissent qu'une fois (`new Set` dans le computed)

**Nettoyage**
- [ ] `removeTypingUser(userId)` → retire l'utilisateur d'`actors`
- [ ] `removeTypingUser` d'un id absent → liste inchangée

**Prérequis** : `whisper = vi.fn()`, `currentUser = ref({ id, name })`.

---

### Couche 3 — `useChatScroll.test.js`

**Périmètre** : `composables/useChatScroll.js`. Utilise `onMounted`/`onUnmounted`/`watch`
→ **doit** passer par `withSetup`. DOM + `setTimeout` sensibles (cf. ARCHITECTURE : ne pas
« simplifier » les `setTimeout(1000)`).

> Les refs `messageContainer` / `messageContainerInner` sont possédées par le composable :
> après `withSetup`, leur affecter des éléments DOM factices (`document.createElement('div')`)
> et stubber `scrollHeight` / `scrollTop` / `clientHeight` via `Object.defineProperty`.

**stick-to-bottom (`onScroll`)**
- [ ] proche du bas (`distanceFromBottom <= 120`) → `stickToBottom = true`, `hasNewMessages = false`
- [ ] remonté dans l'historique (> 120) → `stickToBottom = false`
- [ ] remonté → après `IDLE_REENABLE_MS` (fake timers) `stickToBottom` se réarme à `true`
- [ ] retour en bas → `hasNewMessages` repasse à `false`

**watch(messages)**
- [ ] nouveau message en **fin** de liste (dernier `id` change) **et** `stickToBottom` true →
  déclenche le scroll après `setTimeout(1000)` (avancer les fake timers)
- [ ] nouveau message en fin **mais** `stickToBottom` false → `hasNewMessages = true`, **pas** de scroll
- [ ] **pagination** (préprend en tête, dernier `id` inchangé) → ni scroll ni `hasNewMessages`
  (garde-fou anti-saut décrit dans ARCHITECTURE)

**scrollToBottom / scrollToBottomIfStuck**
- [ ] `scrollToBottom()` → `scrollIntoView` appelé sur `messageContainerInner`, flags reset
- [ ] `scrollToBottomIfStuck()` avec `stickToBottom` true → scrolle
- [ ] `scrollToBottomIfStuck()` avec `stickToBottom` false → ne scrolle pas

**onTriggerObserver (pagination)**
- [ ] `nextPageUrl` non nul → `loadConversation(null, url)` appelé ; après résolution,
  `scrollTop` compensé de `newScrollHeight - previousScrollHeight`
- [ ] `nextPageUrl` null → aucun appel à `loadConversation`

**Lifecycle**
- [ ] `onMounted` : listener `scroll` ajouté sur `messageContainer` (passive)
- [ ] `onUnmounted` : listener retiré + `idleTimer` nettoyé (pas de fuite)

**Prérequis** : `withSetup` ; `vi.useFakeTimers()` ; `messages`/`nextPageUrl` = `ref(...)` ;
`loadConversation = vi.fn().mockResolvedValue()` ; stub `scrollIntoView` (absent de happy-dom)
et des propriétés de dimension.

---

### Couche 4 — `ChatComponent.test.js` (montage + câblage)

**Périmètre** : on ne re-teste pas la logique des composables (déjà couverte), mais le
**câblage** propre au composant : handlers, watchers, lifecycle, slots. Montage via
`@vue/test-utils` `mount()` avec stores réels seedés + globaux stubés.

**Méthodes / handlers**
- [ ] `onSendMessage(msg)` : appelle `sendMessage(msg, conversationId, attachedFiles)`,
  remet `stickToBottom = true`, vide les attachments (`clearAttachments`), reset hauteur
  messenger, **et** `eventBus.$emit('sended-messenger-message')`
- [ ] `onSelectedEmoji(emoji, message)` : `sendEmoji({ emoji, messageId, chatId, from: me.slug })`
- [ ] `onDeleteMessage(id)` : `deleteMessage({ messageId, chatId, from })`
- [ ] `onUpdateMessage(msg, id)` : `updateMessage({ message, messageId, chatId })`
- [ ] `onRecorded(formData)` : append `message` vide + `chat_id`, puis `sendAudio(formData)`
- [ ] `onRemoveFile(id)` : délègue à `messengerInput.value.removeFile(id)` (ref de template)
- [ ] `onWysiwyg(true)` → hauteur = `initial + 300` ; `onWysiwyg(false)` → hauteur = `scrollHeight`
- [ ] `onShowFileInModal(url)` → `fileUrl = url`, `showModal = true` ; `onHideModal` → false

**Câblage Reverb (listeners passés à `useReverbPresence`)**
- [ ] `.receivedMsg` avec `is_bot_answer: true` → `removeActorWriting('Agent Bot')` puis `receiveMessage`
- [ ] `.receivedMsg` standard → `receiveMessage` + scroll différé (300 ms)
- [ ] `.botWriting` → `addActorWriting('Agent Bot')` (apparaît dans `actors`)
- [ ] `.deletedMessage` → `deletedMessage(event.vertexid)`
- [ ] `.updateConversationTitle` → émet `update-conversation-title` avec le titre

**Computed `chatters`**
- [ ] `isBot` false → `chatters === presentUsers`
- [ ] `isBot` true + `agentBot` résolu → `presentUsers + [agentBot]`
- [ ] `watch(chatters)` → émet `update-chatters`

**Lifecycle**
- [ ] IIFE « created » : `isBot` true → import `agentSettings` et résolution de `agentBot`
  (matcher sur `bot_id`)
- [ ] pas de conversation courante + `autoload` true → `loadConversation(vertexId || route.params.vertexId)`
- [ ] `autoload` false → **pas** d'appel `loadConversation`
- [ ] `onMounted` → `intersectionObserver = true`
- [ ] `onBeforeUnmount` → `Echo.private(me.channel).whisper('leave-chat', { chatId, userId })`
- [ ] `onUnmounted` → `resetConversation(currentConversationIdBackup)`

**Slots (API publique — cf. ARCHITECTURE)**
- [ ] `displayUsers` true → `RoomUsersList` rendu ; false → absent
- [ ] slot `#message` custom → reçoit le scope attendu (`item`, `index`, handlers `on*`)
- [ ] slot `#input` custom → reçoit `onSendMessage`, `startWriting`/`stopWriting`, etc.
- [ ] aucun message → slot `#empty` rendu avec `conversationId`

**Prérequis** :
- stubs globaux `Echo`, `vue-router` (`useRoute`), `eventBus` (provide) — cf. section infra
- stores réels seedés (`useChatStore`, `useMeStore`) via helper
- composants asynchrones (`RoomUsersList`, `ModalWidget`, `UploadFilesTable`) en `stubs`
- directive `v-resizable` : la fournir en `global.directives` ou stub no-op
- `mount(ChatComponent, { global: { plugins:[pinia], provide:{eventBus}, stubs, directives }, props })`

---

## Notes

- Les invariants de [`docs/modules/chat.md`](../docs/modules/chat.md) (noms de refs de template, `setTimeout` du scroll,
  `onRemoveFile` dans le composant) sont des **points de test**, pas à contourner.
- Couches 0-2 ne nécessitent aucun ajout d'infra → démarrables immédiatement.
- Couche 3 nécessite fake timers + DOM factice. Couche 4 nécessite les helpers `Echo`/router.
