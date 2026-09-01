# Canal data — la traduction v1 → v2, écrite une fois

> **Recette de chantier, lot D de [doc-rustines.md](doc-rustines.md).** Elle s'ouvre en migrant
> **D1** (Whiteboard), **D2** (Application) et **D3** (ClassRoom), et rien d'autre.
>
> **Condition de suppression : ce fichier part avec `components/WebRTC/`, au lot F/G.** Une fois la
> v1 supprimée, sa colonne de gauche ne décrit plus rien — le précédent est `work/webrtc-v1-notes.md`,
> supprimé le jour où sa condition de conservation a été remplie.
>
> **Tout ce qui concerne la v2 est dans [`docs/modules/webrtc2/api.md`](../docs/modules/webrtc2/api.md)
> et n'est pas recopié ici** — signatures des callbacks, `sendData`, les quatre cas où
> `onDataReceived` n'arrive pas. Deux copies d'un même fait divergent. Ce fichier ne porte que le
> **delta**, et ce qu'il faut faire de la v1.

---

## A. La bascule de balise

`<DataUserPeerConnection :users :roomId :callback-connection>` →
`<MediaBroadcastProvider ref="…" :users :room :callbacks>`.

`mode="data"` n'est pas à écrire : c'est le **défaut** de la prop.

| v1 | v2 |
|---|---|
| `roomId` (`String`, défaut `'default'`) | **`room`** (`String`, défaut `null` → `'app'`) |
| `users` (`type: Object`, requis — alors que les trois passent un tableau) | `users` (**`Array`**, requis) |
| `callbackConnection` (`Function`) | `callbacks` (`Object`, 4 clés utiles) — voir §B |
| `emits: ['connected']` | **rien** |
| aucune option | `options` — **ne rien passer** |

⚠️ **`:room` toujours explicite.** Sans elle, `room` retombe sur `'app'` et le `contextId` devient
`data-app` — celui que `System/Notifications.vue` occupe **en permanence sur toute page** (il appelle
`useMediaBroadcast()` nu). Le registre de contextes est en **last-write-wins muet**
(`peers2Store.contextRegistry.test.js`) : le dernier monté capte tout le routage entrant, le premier
reste vivant et **sourd**. Aucun avertissement.

⚠️ **v1 ne rendait aucun nœud** (`<template></template>` vide) ; **v2 rend un `<div>` wrapper**, qui
reçoit en plus les attributs de fallthrough. À regarder aux trois emplacements, qui sont tous
différents : fin de `div.board-wrapper` (Whiteboard), tête de template (Application), **second nœud
racine** après un `<Teleport>` (ClassRoom).

**Trois choses de la v1 à NE PAS porter**, toutes trois déjà tranchées :

- **le `deep: true // keep this`** du watcher `users` — rien ne mute un objet `user` en place, le
  commentaire ne gardait rien de plus que le superficiel (sortie B, tranchée en A2) ;
- **le garde `if (newVal.length === 0) return`** — le premier tour à vide est traité par conception en
  v2 (`presenceSynced` ne passe à `true` que sur un tour qui a **observé** un membre) ;
- **`@connected`** — l'événement était **mort en v1** (`isConnected` n'est pas dans le retour
  d'`usePeers`, le watcher ne se déclenchait jamais) et branché par personne. Aucun équivalent v2 :
  l'état de connexion se lit sur `api.remotePeers` / `api.presenceSynced` / `api.localPeerId`, ou
  s'observe par `onConnectionOpen`.

ℹ️ **Le watch de `users` du provider v2 n'est pas profond, et ce n'est pas un problème ici** : A2 a
mesuré que la liste est **réaffectée** par `useReverbChannel` sur ses quatre chemins d'écriture, et
que les trois modules ne la possèdent pas — ils la reçoivent en prop du `<router-view>` unique de
`Server/Room.vue`. Le contrat est épinglé **aux deux bouts** depuis A3
(`MediaBroadcastProvider.test.js` côté consommateur, `useReverbChannel.test.js` côté source). Rien à
adapter, ni chez l'appelant ni chez le provider.

⚠️ **`options` : ne rien passer.** Le défaut est mesh, ce dont les trois modules ont besoin. Et un
objet passé **remplace le défaut en bloc** — `:options="{ hubSlug: 'x' }"` fait disparaître
`topology`, qui retombe silencieusement sur mesh (épinglé par `MediaBroadcastProvider.test.js`).

Garder les `v-if` existants tels quels.

---

## B. La bascule de callback — le vrai travail du lot

**v1** : `callbackConnection(conn)` reçoit la `DataConnection` **nue**, **et seulement pour les
connexions entrantes**, puis l'appelant pose lui-même ses `conn.on('data')`, `conn.on('open')`,
`conn.on('close')`.

**v2** : le transport possède les listeners et rappelle des callbacks nommés. Les signatures exactes,
et les quatre cas où `onDataReceived` n'arrive pas ou arrive en arité 1, sont dans
[`api.md`](../docs/modules/webrtc2/api.md#le-canal-data--les-callbacks-et-senddata). **Chaque appelant
se réécrit** : il n'y a pas de substitution mécanique.

Pour ces trois modules, la voie est **`:callbacks` sur le provider** — ils sont en Options API et
gèrent la réception eux-mêmes. L'objet se déclare en `computed` ou en `data` ; le provider ne le lit
qu'une fois, en `onMounted`.

⚠️ **`:callbacks` XOR `api.initialize()` dans un enfant, jamais les deux** : le stockage est
write-once par clé et le second jeu est **perdu en silence** (cf. `api.md`).

⚠️ **Ne pas reproduire le geste v1** en posant `conn.on('data')` dans `onConnectionOpen` : cela
doublerait la réception **et** contournerait la garde de taille et l'interception des enveloppes
d'infra.

---

## C. La bascule d'émission — quatre écarts, tous silencieux

`mapActions(usePeerStore, ['sendData'])` puis `this.sendData({ data: … }, roomId)` →
**`this.$refs.<ref>.api.sendData(payload, destUserSlugs)`**.

| # | v1 | v2 |
|---|---|---|
| 1 | **enveloppe** : `sendData({ data: payload }, roomId)` — le store n'émet que `message.data` | `api.sendData(payload)` — le payload **directement**, sans enveloppe |
| 2 | **sérialisation** : `safeStringify(message.data)`, donc une **chaîne** sur le fil, d'où le `JSON.parse` de chaque récepteur | l'**objet** part tel quel ⇒ **supprimer les trois `JSON.parse`** |
| 3 | **room** : 2ᵉ argument, explicite chez les trois | **aucune** — figée à la construction du contexte |
| 4 | **destinataires** : `{ include: [...] }` / `{ exclude: [...] }` dans le message, honorés par le store | `destUserSlugs` en 2ᵉ argument — l'équivalent d'`include` seul |

**Écart 2 — les trois sites, et un piège de grep.** `WhiteboardComponent.vue:138`,
`ClassRoomComponent.vue:140`, `ApplicationComponent.vue:248`. ⚠️ **Application a quatre `JSON.parse`
et un seul est celui du canal data** : `:153` (dépendances du composant), `:217` (message venant de
l'iframe, gardé par `isStringifiedJSon`) et `:241` (clone avant `postMessage`) **restent**.

> Cet écart contredit le cadrage du lot 1, qui annonçait « les `JSON.parse` des trois appelants
> restent valables tels quels ». Ils ne le sont pas : laissés en place, ils reçoivent un objet et
> lèvent. C'est la seule affirmation structurante de ce fichier que **aucun test ne tient** —
> `usePeerTransport.mesh.test.js` épingle bien l'absence de transformation à l'émission, mais tous ses
> cas passent une chaîne ou un `ArrayBuffer`, jamais un objet.

**Écart 3.** Un composant qui émet vers deux rooms a besoin de deux contextes, donc de deux
providers. C'est déjà la situation de ClassRoom (le sien, plus celui du Whiteboard imbriqué) : rien à
changer, mais rien à fusionner non plus.

**Écart 4 — le point ouvert, à trancher au lot D2.** `exclude` **n'a aucun équivalent** : le
complément se calcule depuis `api.remotePeers.value`, qui exclut déjà mon slug. ⚠️ Un message v1
portant `include` passerait en v2 comme un simple champ de payload — **sans filtrer personne**, et
sans erreur. Application est le seul consommateur des deux.

**L'accès à l'api** : `defineExpose({ api })` ⇒ `this.$refs.<ref>.api`. Aucun des trois n'a de `ref`
sur le provider aujourd'hui — c'est une **addition nette**, pas un remplacement. Les deux autres voies
(slot `v-slot="webrtc"` → `webrtc.api`, et `inject(WEBRTC_API_KEY)` pour un descendant) sont
documentées dans `api.md` et ne servent pas ces trois-là.

⚠️ **La migration débranche aussi le store v1** : retirer `import { usePeerStore }` et le
`mapActions(usePeerStore, …)` des trois fichiers. Ce n'est pas une substitution de balise — c'est ce
qui rend le lot F possible.

⚠️ **Les états de l'api sont des `ref`**, y compris en template : `api.remotePeers.value`,
`api.mySlug.value`, `api.onAirRoom.value` (modèle `Exemples/ChatSimple/ChatSimpleUI.vue`).

---

## D. Ce que chaque lot a en propre — mesuré, pas supposé

**D1 · Whiteboard** — `Whiteboard/WhiteboardComponent.vue`

- **Le seul des trois qui imbrique `conn.on('data')` DANS `conn.on('open')`** : à aplatir en deux
  callbacks indépendants.
- **L'effet de bord du `on('open')` est réel et doit être préservé** : un `setTimeout(…, 1000)` relit
  la scène Excalidraw (`getSceneElements` / `getAppState` / `getFiles`) et la renvoie à l'arrivant,
  sous condition `!isSavable`. C'est ce qui fait qu'un nouveau venu voit le tableau déjà tracé.
- **Sa room n'est pas `room.id`** mais `whiteBoardId` = `room.content[0].id ?? room.id` — l'id du
  vertex de contenu.
- Deux émissions : `update_scene` (mouseup) et `pointer_move`.

**D2 · Application** — `Application/ApplicationComponent.vue`

- **Dépend de `conn.metadata.from`** (deux sites : `connectionEnabled` et `connectionDisabled` vers
  l'iframe). v2 fournit le **même champ**, en 3ᵉ argument d'`onDataReceived` — mais il est **absent en
  arité 1** (hub star). Sur une connexion entrante, `from` est le slug du pair distant et `slug` le
  mien.
- **Porte le seul usage d'`include`/`exclude`**, via le protocole iframe documenté par
  `Application/Exemples/WebrtcDataConnection.txt`. Voir l'écart 4.
- ⚠️ Sa prop `room` a un `default: () => {}` dont le corps est vide : elle rend **`undefined`**, donc
  sans prop `room` le `v-if` est faux et le provider ne monte pas.
- **L'enveloppe d'émission est différente des deux autres** : le module passe le message de l'iframe
  tel quel (`{ action: 'broadcast', data: {…} }`), et `action` est **perdu en route** — le store
  n'émet que `message.data`. Le récepteur reçoit donc `{ event, payload }`, pas `{ action, data }` :
  il n'a pas de `switch(data.action)`, contrairement aux deux autres.

**D3 · ClassRoom** — `ClassRoom/ClassRoomComponent.vue`, **en dernier**

- **Deux providers vivants** : le sien (`room.id`) et celui du Whiteboard qu'il imbrique
  (`subcontent.id`), donc **deux `contextId` distincts** sur le `Peer` singleton. Le cas est couvert
  par `scenarios/multiContext.test.js` — le citer plutôt que le re-vérifier.
- Nécessite **D1 déjà migré dessous**.
- Lit `conn.connectionId` (journalisation) : inchangé en v2.
- Deux émissions : `whiteboard-toggle` et `chat-toggle`.

**Vérification, pour les trois** : aucun de ces composants n'a de test et aucun n'en recevra — ce sont
des composants métier hors du filet. La vérification est **manuelle, à deux navigateurs**, et elle est
nommée lot par lot dans [doc-rustines.md](doc-rustines.md). `npm run build` reste le seul contrôle qui
voie un import cassé.

---

## Hors périmètre

Le **lot E (AudioRoom)** migre un provider **media** v1, dont le delta est ailleurs et n'est pas
écrit ici : slot v1 à **20 clés à plat** → une seule clé `api` portant des `ref`, et
`emits: ['started-stream', 'stoped-stream']` **sans équivalent v2** (le provider v2 n'émet rien). E
l'écrira quand il partira, avec le code sous les yeux — une table écrite d'avance périmerait, comme
les décomptes du lot C.
