# ChatComponent — Décisions d'archi & invariants

Note vivante : rationale qui n'est **pas** déductible du code. À compléter au fil des
évolutions. (Issu de la refacto en composables, todolist retirée une fois terminée.)

---

## Invariants à préserver

- **Mêmes noms de refs de template** (`messageContainer`, `messageContainerInner`,
  `messenger`, `messengerInput`) — plusieurs composables s'y branchent.
- `onRemoveFile` reste **dans le composant** : il croise la ref `messengerInput`
  (appelle `messengerInput.value.removeFile(id)`).
- Hooks `onBeforeUnmount` (whisper `leave-chat`) et `onUnmounted` (`resetConversation`)
  restent dans le composant.
- `useReverbPresence` est déjà un composable partagé : **ne pas y toucher** depuis ici.

## Pièges à ne PAS « optimiser »

- **Scroll / pagination** (`composables/useChatScroll.js`) : conserver tels quels les
  `setTimeout(1000)` et le calcul de `scrollTop` à la pagination. Ils compensent le
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

| Fichier | Responsabilité |
|---------|----------------|
| `composables/useChatAttachments.js` | `attachedFiles`, `onFileAdded`, `removeFromList`, `clear` |
| `~socializer/composables/useResizableElement.js` | resize générique via variable CSS ; `resizeOptions` à brancher sur `v-resizable`. ⚠️ directive `resizable_horizontal` = poignée horizontale ⇒ resize **hauteur** (pas un bug) |
| `composables/useTypingIndicator.js` | indicateur « écrit… » ; transport **unifié Reverb** (whisper `typing` entre users + signal serveur pour Agent Bot) |
| `composables/useChatScroll.js` | auto-scroll + pagination infinie |
| `utils/dateSeparator.js` | fonction pure `shouldShowDateSeparator(messages, index, displaySeparator)` |

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
