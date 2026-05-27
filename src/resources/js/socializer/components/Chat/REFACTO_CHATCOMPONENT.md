# Refacto ChatComponent.vue — extraction en composables

Objectif : alléger `ChatComponent.vue` (~290 lignes de logique) en déplaçant les
responsabilités autonomes dans des composables, sous
`~socializer/components/Chat/composables/`.

Ordre choisi : du plus sûr au plus délicat. On valide chaque étape (build + test
manuel du chat) avant de passer à la suivante.

---

## Phase 0 — Préparation
- [✅] Créer le dossier `~socializer/components/Chat/composables/`
- [✅] Vérifier l'alias de résolution pour le nouveau dossier (imports `~socializer/...`)

## Phase 1 — `useChatAttachments.js` (risque faible)
- [✅] Créer le composable : `attachedFiles`, `onFileAdded`, `removeFromList`, `clear`
- [✅] Brancher dans le composant (template `UploadFilesTable` + `TextareaMessage`)
- [✅] Remplacer `attachedFiles.value = []` de `onSendMessage` par `clear()`
      (exposé sous l'alias `clearAttachments` pour éviter la collision de nom)
- [✅] Laisser `onRemoveFile(fileId)` dans le composant (couplage `messengerInput`)
- [✅] Vérif : ajout / suppression / envoi d'un fichier

## Phase 2 — `useResizableElement.js` (risque faible) ✅
> Choix d'archi : composable **générique** `useResizableElement.js` placé dans
> `~socializer/composables/` (et non un `useResizableMessenger.js` couplé au chat),
> pour être réutilisable par tout composant à dimension pilotée par variable CSS.
> Il fournit `resizeOptions` prêt à brancher sur `v-resizable` (callback câblé),
> plus `size` / `applySize` / `reset`. La directive utilisée est bien
> `resizable_horizontal.js` (poignée horizontale ⇒ resize **hauteur**) : pas de bug.
> `onWysiwyg` reste dans le composant (spécifique messenger, non réutilisable).
- [✅] Créer le composable générique : `size`, `applySize`, `reset`, `resizeOptions`
      (config : `cssVar`, `min`, `max`, `initial`, `position`)
- [✅] Brancher dans le composant : `v-resizable="resizeOptions"`,
      event `@update-height` → `applySize` (alias `updateElHeight`)
- [✅] Remplacer le reset de hauteur inline de `onSendMessage` par `resetMessengerHeight()`
- [✅] Vérif : build OK + redimensionnement manuel / WYSIWYG / reset après envoi

## Phase 3 — `useTypingIndicator.js` (risque moyen)
> ⚠️ Choix d'archi : transport **unifié Reverb** (au lieu du data channel WebRTC).
> Users via whisper `'typing'` ; Agent Bot via signal serveur (`.botWriting` /
> `.receivedMsg`). `DataUserPeerConnection` supprimé (reliquat pré-MediaBroadcastProvider).
- [✅] Créer le composable : `actors`, `onTypingWhisper`, `startWriting`,
      `stopWriting`, `addActorWriting`, `removeActorWriting`
      (deps : `currentUser`, `whisper`)
- [✅] Brancher l'option `whispers: { typing: onTypingWhisper }` de `useReverbPresence`
      + events `@start-writting` → `startWriting` / `@stop-writting` → `stopWriting`
- [✅] Recâbler les listeners Reverb bot (`.botWriting`, `.receivedMsg`) vers
      `addActorWriting('Agent Bot')` / `removeActorWriting('Agent Bot')`
- [✅] Vérif : indicateur "écrit..." entre 2 users + cas Agent Bot

## Phase 4 — `useChatScroll.js` (risque le plus élevé — porter à l'identique)
> `scrollView` reste appelé par le composant dans `onReceiveMessage` (setTimeout 300) :
> il est donc exposé par le composable. `waitImagesAndScroll` est interne (watch +
> onMounted gérés dans le composable). L'`onMounted` du composant ne garde que
> l'activation de `intersectionObserver`.
- [✅] Créer le composable : refs `messageContainer`/`messageContainerInner`,
      `scrollView`, `waitImagesAndScroll`, `onTriggerObserver`
      (deps : `messages`, `nextPageUrl`, `loadConversation`)
- [✅] Déplacer le `watch(messages)` et le `waitImagesAndScroll()` d'`onMounted`
      dans le composable
- [✅] ⚠️ Conserver tels quels les `setTimeout(1000)` et le calcul de `scrollTop`
      à la pagination (lignes ~353-358) — NE PAS "améliorer"
- [✅] Vérif : build OK ; reste à valider manuellement scroll auto au nouveau message,
      scroll après chargement d'images, pagination infinie (scroll vers le haut)
      sans saut de position

## Phase 5 — Nettoyage / optionnel
- [✅] Extraire `shouldShowDateSeparator` dans `utils/dateSeparator.js` (fonction pure)
      Signature `(messages, index, displaySeparator = true)`. Wrapper conservé dans
      le composant pour ne pas toucher au `<template>` (alias import `computeDateSeparator`).
- [⏭️] (Abandonné) `useChatMessages.js` : les handlers ciblés sont des adaptateurs
      d'une ligne vers le store ; les extraire déplace du câblage sans isoler de
      responsabilité autonome (et `onSendMessage` croise attachments/resize/eventBus).
      À reconsidérer seulement si cette logique s'étoffe.
- [⏭️] (Différé) `useChatBot.js` : concern cohérent mais tangent au typing indicator
      et à la présence Reverb (`chatters`, `addActorWriting('Agent Bot')`). Risque moyen
      pour un gain modeste — à tenter si la logique bot grossit.
- [✅] Relecture finale du `<script setup>` : code mort supprimé (355 → 325 lignes)
      - imports inutilisés : `IconWidget`, `ChatContactsButton`, `useRouter`
      - composants async jamais montés (absents du template) : `MediaBroadcastProvider`,
        `StreamDefaultUserButtonUI`, `CaptureDefaultUserButtonUI`
      - bindings morts : `videoContainer`, `isContactBtnVisible`, `onAddContact`,
        `onQuitChat`, `router`, + actions store associées (`addContactToConversation`,
        `leaveCurrentConversation`)

---

## Invariants à préserver
- Garder les **mêmes noms de refs de template** pour ne pas toucher le `<template>`.
- `onRemoveFile` reste dans le composant (croise `messengerInput`).
- Les hooks `onBeforeUnmount` (whisper `leave-chat`) et `onUnmounted`
  (`resetConversation`) restent dans le composant.
- `useReverbPresence` est déjà un composable : ne pas y toucher.
