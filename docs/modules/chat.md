# Chat — Décisions d'archi & invariants

> **À quoi ça sert :** le rationale du `ChatComponent` qui n'est **pas** déductible du code.
> **Quand le lire :** avant de refactorer le chat, d'extraire un composable, ou de « simplifier »
> un `setTimeout`.

Code : `src/resources/js/socializer/components/Chat/`
Tests : un seul fichier aujourd'hui — plan dans [`work/chat-tests-plan.md`](../../work/chat-tests-plan.md).

Note vivante, à compléter au fil des évolutions. (Issue de la refacto en composables ; la todolist
a été retirée une fois terminée — c'est le modèle à suivre, cf. [ecrire-la-doc.md](../ecrire-la-doc.md).)

---

## Invariants à préserver

- **Mêmes noms de refs de template** (`messageContainer`, `messageContainerInner`,
  `messenger`, `messengerInput`) — plusieurs composables s'y branchent.
- `onRemoveFile` reste **dans le composant** : il croise la ref `messengerInput`
  (appelle `messengerInput.value.removeFile(id)`).
- Hooks `onBeforeUnmount` (whisper `leave-chat`) et `onUnmounted` (`resetConversation`)
  restent dans le composant.
- `useReverbPresence` est déjà un composable partagé : **ne pas y toucher** depuis ici.

## La visio n'appartient pas au chat

**`ChatComponent.vue` n'embarque ni visio ni audio.** Les imports v1
(`MediaBroadcastProvider`, `StreamDefaultUserButtonUI`, `CaptureDefaultUserButtonUI`) y ont été
retirés : ils étaient importés mais **jamais montés** dans le `<template>` — résidu de copier-coller,
et venus du `WebRTC/` v1 mort, monté nulle part dans le paquet.

Le paquet suit un patron **« provider + slot, monté au besoin »** : `MediaBroadcastProvider` porte la
logique de connexion et de flux, le **parent** fournit l'UI en slot selon le cas (voir
`components/AudioRoom/AudioComponent.vue` et `components/WebRTC2/Exemples/Home.vue`).

**Quand la visio doit cohabiter avec le chat, la composer dans le parent** — monter
`<MediaBroadcastProvider>` à côté de `<ChatComponent>`, UI en slot — et cibler `WebRTC2/`. L'embarquer
en dur dans le chat coupleait deux préoccupations et tirait le poids WebRTC dans chaque montage de
chat.

## Pièges à ne PAS « optimiser »

- **Scroll / pagination** (`~socializer/composables/useStickyScroll.js`) : conserver tels quels
  les `setTimeout(1000)` et le calcul de `scrollTop` à la pagination. Ils compensent le
  chargement asynchrone des images ; les « simplifier » réintroduit des sauts de scroll.

## Extractions écartées (ne pas refaire sans nouveau besoin)

- **`useChatMessages.js` (abandonné)** : les handlers de messages sont des adaptateurs
  d'une ligne vers le store ; les extraire déplace du câblage sans isoler de
  responsabilité. De plus `onSendMessage` croise attachments + resize + eventBus.
  À reconsidérer seulement si cette logique s'étoffe.
- **`useChatBot.js` (différé)** : concern cohérent mais tangent au typing indicator et à
  la présence Reverb (`chatters`, `addActorWriting('Agent Bot')`). Gain modeste pour un
  risque moyen — à tenter si la logique bot grossit.

## Composables en place (carte rapide)

Trois des quatre extractions ont atterri dans les composables **partagés** du package
(`~socializer/composables/`), pas dans `Chat/composables/` : elles ne sont pas spécifiques au chat.
Seul `useTypingIndicator` est local.

| Fichier | Responsabilité |
|---------|----------------|
| `~socializer/composables/useFileAttachments.js` | `attachedFiles`, `onFileAdded`, `removeFromList`, `clear` |
| `~socializer/composables/useStickyScroll.js` | auto-scroll + pagination infinie |
| `~socializer/composables/useResizableElement.js` | resize générique via variable CSS ; `resizeOptions` à brancher sur `v-resizable`. ⚠️ directive `resizable_horizontal` = poignée horizontale ⇒ resize **hauteur** (pas un bug) |
| `Chat/composables/useTypingIndicator.js` | indicateur « écrit… » ; transport **unifié Reverb** (whisper `typing` entre users + signal serveur pour Agent Bot) |
| `Chat/utils/dateSeparator.js` | fonction pure `shouldShowDateSeparator(messages, index, displaySeparator)` |

## Slots de customisation (API publique du `<template>`)

Tous **scopés avec fallback** (le contenu par défaut = rendu d'origine, donc
rétrocompatibles). Région volontairement laissée hors slots : `IntersectionObserver`
(pagination — ne pas slotter), bloc typing, bouton « Nouveaux messages »,
`UploadFilesTable`, modale.

| Slot | Scope | Fallback |
|------|-------|----------|
| `sidebar` | `{ users }` | `RoomUsersList` (garde `v-if="displayUsers"`) |
| `before-messages` | — | (vide) bannière/header en tête de liste |
| `empty` | `{ conversationId }` | (vide) affiché si aucun message |
| `date-separator` | `{ date }` | `DateSeparator` |
| `message` | `{ item, index, conversationId, onSelectedEmoji, onDeleteMessage, onUpdateMessage, onShowFile }` | `MessageWidget` |
| `input` | `{ startWritting, stopWritting, onSendMessage, onWysiwyg, updateHeight, onRecorded, onFileAdded, removeFromList }` | `TextareaMessage` |

**Contrat `#input`** : le `messenger` ref + `v-resizable` restent sur le `<div.chat-messenger>`
(non slotté) → resize OK quel que soit le contenu. En revanche, un input custom **riche**
(pièces jointes + WYSIWYG) doit exposer `removeFile(id)` et `scrollHeight` (utilisés par
`onRemoveFile`/`onWysiwyg`). Pour un input **simple** (champ + bouton), il suffit d'appeler
`onSendMessage(texte)` ; les autres handlers sont optionnels.
