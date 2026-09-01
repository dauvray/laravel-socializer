# Canal data — la traduction v1 → v2, écrite une fois

> **Recette de chantier, lot D de [doc-rustines.md](doc-rustines.md).** Elle s'ouvre en migrant
> **D1** (Whiteboard), **D2** (Application) et **D3** (ClassRoom), et rien d'autre. ✅ **Les trois
> sont faits, le 01/09/2026. Cette recette n'a plus d'usage** : elle ne survit que le temps de la
> v1, dont elle décrit la colonne de gauche — condition de suppression ci-dessous.
>
> **D3 l'a corrigée sur un quatrième point, et c'est une espèce nouvelle : un fait exact mais SANS
> OBJET.** Elle instruisait « lit `conn.connectionId` (journalisation) : inchangé en v2 » — vrai, et
> portant sur une ligne que le lot allait **supprimer**. Une recette peut donc être juste et faire
> perdre du temps, en décrivant ce qui ne survit pas à la migration qu'elle décrit.
>
> **D1 a corrigé la recette sur deux points, tous deux valables pour D2 et D3** : `onConnectionOpen`
> tire dans les **deux sens** (§B), et le plafond de 64 Ko est une **régression** de la v2 sur la v1
> (§C, écart 5). Une recette écrite par lecture se vérifie au premier lot qui l'exécute.
>
> **D2 l'a corrigée sur un troisième, et c'est un mot qui était de trop** : elle donnait
> `onConnectionClose` pour **« indemne »** du problème de sens. Il ne l'est pas — il tire une fois par
> connexion, donc sur les **deux** connexions de la paire. *(Sans objet à D3, qui n'a aucun effet de
> bord de connexion — mais le fait reste vrai du contrat, et il vit dans `api.md`.)* Et D2 a ajouté un
> fait que ni D0 ni D1 ne pouvaient voir : sur une entrante, un effet de bord de connexion ne peut
> **pas** supposer qu'un canal sortant vers ce pair existe (§D2, le 🔴).
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

⚠️ **Le « seulement pour les connexions entrantes » de la v1 est le piège du lot, et il n'était pas
écrit ici avant D1.** `onConnectionOpen` est appelé dans les **deux sens** (détail et test de sens
dans [`api.md`](../docs/modules/webrtc2/api.md#le-canal-data--les-callbacks-et-senddata)) : tout effet
de bord porté par l'ancien `callbackConnection` s'exécute donc **deux fois par pair** après
substitution, et une fois sur une connexion dont `metadata.from` est **mon propre slug**. Les deux
appelants qui ont un tel effet de bord sont **D1** (renvoi de la scène — traité) et **D2** (annonce
`connectionEnabled` à l'iframe — **traité**, voir §D2). ✅ **D3 n'en a aucun** : sa v1 ne portait que
trois `console.log`, non reportés — c'est le seul des trois qui n'écrit pas de garde de sens.

⚠️ **Et `onConnectionClose` n'en est PAS exempt** — cette recette l'a écrit « indemne », et D2 a
mesuré le contraire. Le garde `customCloseEmitted` ne promet qu'une chose : une fermeture n'est
notifiée **qu'une fois par connexion**. Or la paire en a **deux**. Un effet de bord posé là s'exécute
donc lui aussi deux fois, dont une sur une connexion qui me désigne moi. **Le même prédicat sert les
deux callbacks** — modèle : `ApplicationComponent#isIncomingConnection`.

⚠️ **Ce qu'un effet de bord d'`onConnectionOpen` ne peut PAS supposer, et c'est D2 qui l'a établi :
qu'un canal SORTANT vers ce pair existe.** `sendData` résout par slug dans une map qui ne contient
que mes sortantes, et le mapping `slug → peerId` est écrit par ma propre `connectToPeer` : sur le
chemin présence, l'entrante de l'autre arrive **la première**, avec des secondes d'avance sur ma
sortante inverse (`scenarios/incomingMappingInvariant.test.js`). Un lot qui veut **répondre** à un
arrivant doit répondre **sur la connexion reçue**, pas diffuser par slug. Détail en §D2.

Pour ces trois modules, la voie est **`:callbacks` sur le provider** — ils sont en Options API et
gèrent la réception eux-mêmes. L'objet se déclare en `computed` ou en `data` ; le provider ne le lit
qu'une fois, en `onMounted`.

⚠️ **`:callbacks` XOR `api.initialize()` dans un enfant, jamais les deux** : le stockage est
write-once par clé et le second jeu est **perdu en silence** (cf. `api.md`).

⚠️ **Ne pas reproduire le geste v1** en posant `conn.on('data')` dans `onConnectionOpen` : cela
doublerait la réception **et** contournerait la garde de taille et l'interception des enveloppes
d'infra.

---

## C. La bascule d'émission — cinq écarts, tous silencieux

*(Quatre à l'écriture de la recette ; le cinquième — le plafond de 64 Ko — a été trouvé en exécutant
D1, et il n'est pas dans la table ci-dessous parce qu'il n'oppose pas deux formes mais deux
comportements.)*

`mapActions(usePeerStore, ['sendData'])` puis `this.sendData({ data: … }, roomId)` →
**`this.$refs.<ref>.api.sendData(payload, destUserSlugs)`**.

| # | v1 | v2 |
|---|---|---|
| 1 | **enveloppe** : `sendData({ data: payload }, roomId)` — le store n'émet que `message.data` | `api.sendData(payload)` — le payload **directement**, sans enveloppe |
| 2 | **sérialisation** : `safeStringify(message.data)`, donc une **chaîne** sur le fil, d'où le `JSON.parse` de chaque récepteur | l'**objet** part tel quel ⇒ **supprimer les trois `JSON.parse`** |
| 3 | **room** : 2ᵉ argument, explicite chez les trois | **aucune** — figée à la construction du contexte |
| 4 | **destinataires** : `{ include: [...] }` / `{ exclude: [...] }` dans le message, honorés par le store | `destUserSlugs` en 2ᵉ argument — l'équivalent d'`include` seul |

**Écart 2 — les sites, et un piège de grep.** Trois au départ ; ✅ **les trois sont retirés** —
Whiteboard à D1, Application à D2, ClassRoom à D3.
⚠️ **Le piège s'est vérifié à D2 : Application avait quatre `JSON.parse` et un seul était celui du
canal data.** ℹ️ Il ne s'est **pas** reproduit à D3 — un seul site dans tout `ClassRoom/`, et c'était
le bon. Mais c'est une chose qui se **vérifie**, pas qui se suppose : un lot qui aurait fait
confiance au décompte de trois aurait eu raison ici et tort à D2. Les trois autres sont restés, et devaient rester : les dépendances du composant, le
message venant de l'iframe (gardé par `isStringifiedJSon`) et le clone avant `postMessage`. Ce
dernier est d'ailleurs devenu **load-bearing** au sens de D2 : c'est parce que le récepteur
JSON-round-trip déjà le message que normaliser le payload à l'émission ne retire rien à personne
(§D2).

> Cet écart contredit le cadrage du lot 1, qui annonçait « les `JSON.parse` des trois appelants
> restent valables tels quels ». Ils ne le sont pas : laissés en place, ils reçoivent un objet et
> lèvent. ~~C'est la seule affirmation structurante de ce fichier que **aucun test ne tient**~~ —
> **corrigé à D1** : `usePeerTransport.mesh.test.js` porte désormais le cas de l'objet imbriqué, avec
> l'identité **référentielle** (`toBe`), là où tous ses cas passaient une chaîne ou un `ArrayBuffer`.

🔴 **Cet écart a MORDU, et pas là où on l'attendait — D1, vérification à deux navigateurs.** La
suppression de la sérialisation ne casse pas que les `JSON.parse` du récepteur : elle expose
l'émission à la sérialisation **réelle** du transport. PeerJS sérialise en **BinaryPack**, qui
**lève** sur une `Map` — et l'`appState` d'Excalidraw en porte une (`collaborators`). La v1 ne le
voyait pas : `safeStringify` aplatissait tout en chaîne, et la `Map` y devenait `{}` **par
accident**, jamais par intention.

Trois leçons pour D2 et D3, dont deux dépassent le Whiteboard :

- ⚠️ **Le garde de taille ne protège pas de ça** : il mesure via `JSON.stringify`, qui accepte une
  `Map`. Il rejette une **fonction nue**, ce qui donne l'illusion d'être couvert.
- ⚠️ **Le throw est synchrone dans la boucle de diffusion** : les pairs suivants ne reçoivent rien,
  et il remonte à l'appelant — chez D1, il sautait le `saveScene` placé après, donc il cassait aussi
  la **persistance** du tableau, pas seulement sa propagation.
- ⚠️ **Aucun test ne peut voir ce throw** (`conn.send` est un `vi.fn()`). **La vérification manuelle
  n'est pas une formalité de fin de lot : c'est le seul contrôle qui exerce le transport réel.**

Le contrat durable est dans [`api.md`](../docs/modules/webrtc2/api.md#-senddata-peut-lever-et-le-garde-de-taille-ne-len-protège-pas) ;
seule la comparaison avec la v1 est ici, et elle part avec elle.

**Écart 5 — le plafond de 64 Ko, découvert à D1 : c'est une RÉGRESSION, pas une borne native.** Le
`sendData` du store v1 n'avait **aucune** limite de taille (`stores/peers/actions.js:343-372` :
`safeStringify` puis `conn.send`, PeerJS chunkant lui-même) ; celui de la v2 abandonne l'envoi
au-delà de `MAX_PAYLOAD_BYTES`, **sans un mot**, à l'émission comme en réception. La substitution
introduit donc un mode de panne que la v1 n'avait pas. La borne elle-même et le consommateur qui la
frôle — la scène Excalidraw du Whiteboard — sont écrits dans
[`api.md`](../docs/modules/webrtc2/api.md#apisenddatadata-destuserslugs--null), qui les possède ;
**seul le « c'était mieux avant » est ici**, et il part avec la v1. Assumé à D1, tâche de découpe ou
de delta ouverte dans [doc-rustines.md](doc-rustines.md).

**Écart 3.** Un composant qui émet vers deux rooms a besoin de deux contextes, donc de deux
providers. C'est déjà la situation de ClassRoom (le sien, plus celui du Whiteboard imbriqué) : rien à
changer, mais rien à fusionner non plus.

**Écart 4 — ✅ TRANCHÉ au lot D2 : le ciblage est conservé, en entier.** `exclude` **n'a aucun
équivalent** v2, et son complément se calcule chez l'appelant depuis `api.remotePeers.value`, qui
exclut déjà mon slug ; `include` passe tel quel en `destUserSlugs`, et les deux filtres se cumulent
comme le faisait le store v1. Six lignes, `ApplicationComponent#resolveDestinations`, seul
consommateur des deux. Le protocole iframe n'a **pas** changé d'une ligne.

⚠️ **Le piège que ce code ferme, et il était bien réel** : un message portant `include` laissé dans
le payload y passerait comme un simple champ — **sans filtrer personne**, et sans erreur.

⚠️ **Deux fidélités qui ne se devinent pas.** `null` ⇒ tous les pairs, mais un tableau **vide** ⇒
**personne** : côté `sendData`, `destUserSlugs || remotePeers` voit un `[]` comme *truthy*. C'est ce
qui rend « exclure tout le monde » et « n'inclure personne » fidèles à la v1. Et la base de calcul a
changé — v1 : les connexions **ouvertes**, v2 : les membres **présents**. Écart **assumé** : un
membre sans connexion data produit un `console.warn` par slug au lieu d'être ignoré, la livraison est
la même.

ℹ️ **L'alternative écartée, et pourquoi.** On pourrait descendre `exclude` dans `sendData` — le
transport résout déjà `destUserSlugs || remotePeers`, une option y tiendrait naturellement, et les
trois modules en profiteraient. Écartée à D2 : ça élargit un lot de **migration** à l'API du
transport, qui a ses tests, sa forme d'enveloppe étoile et une surface décrite dans `securite.md` —
et la règle du chantier veut qu'un lot ne change pas un comportement *et* ne déplace pas du code en
même temps. Si le besoin réapparaît, c'est une tâche propre avec son test rouge d'abord.

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

**D1 · Whiteboard** — `Whiteboard/WhiteboardComponent.vue` — ✅ **MIGRÉ le 01/09/2026**, corrigé le
même jour après la vérification à deux navigateurs

- 🔴 **Ce que la vérification a trouvé, et que trois relectures n'avaient pas vu** : `update_scene`
  levait à chaque `mouseup` (§C, écart 5 — la `Map` de l'`appState`). Le correctif est de **ne plus
  émettre l'`appState` du tout**, et il ne coûte rien : `ExcalidrawElement.updateScene` lit
  **`data.state`**, une clé que **personne n'émet** — ni ce composant, ni le serveur. L'`appState`
  transmis n'a donc **jamais** été appliqué, en v1 comme en v2. Le retirer enlève une `Map`, la plus
  grosse part inutile du payload, et **rien** à personne.
- ℹ️ **La méthode de D1 est ce qui a rendu le correctif sûr, pas la chance** : avant de choisir
  comment sérialiser (round-trip JSON ? retirer `collaborators` ?), on a lu le **récepteur**. La
  question « quoi émettre » n'avait pas de réponse tant qu'on ignorait ce qui était lu en face.

- **Le seul des trois qui imbriquait `conn.on('data')` DANS `conn.on('open')`** : aplati en deux
  callbacks indépendants (`handleDataReceived`, `handleConnectionOpen`), passés par `:callbacks` via
  un `computed` `dataCallbacks` de deux lignes qui ne fait que pointer les deux méthodes — le code du
  canal data reste ainsi dans `methods`, sous la bannière qu'il avait déjà.
- **L'effet de bord du `on('open')` est réel et doit être préservé** : un `setTimeout(…, 1000)` relit
  la scène Excalidraw (`getSceneElements` / `getAppState` / `getFiles`) et la renvoie à l'arrivant,
  sous condition `!isSavable`. C'est ce qui fait qu'un nouveau venu voit le tableau déjà tracé.
  ⚠️ **Le préserver a demandé un garde que cette recette n'annonçait pas** : le test de sens de la
  connexion (§B). Sans lui, chaque pair renvoyait sa scène **deux fois** par arrivant.
  ⚠️ **Le préserver a coûté un VERBE DE TRANSPORT, pas seulement un garde de sens — trouvé le
  01/09/2026, en production, sur le symptôme « le tableau de l'arrivant est vide ».** Le renvoi
  émettait par `sendData`, qui résout sa connexion PAR SLUG dans la map `connections` du store des
  pairs — laquelle ne contient que les connexions SORTANTES (`storePeerConnection` n'a qu'un appelant,
  `_saveRoomConnection`, tous ses sites dans `connectToPeer` ; le dispatcher entrant appelle
  `setUpConnectionListeners(conn)` et rien d'autre). La connexion qui déclenche `onConnectionOpen`
  chez le pair déjà présent étant l'ENTRANTE — c'est la condition du garde de sens —, elle n'y figure
  jamais : le renvoi dépendait de la sortante inverse, qui exige un aller-retour de signalisation
  complet sur le chemin présence (le mapping du récepteur est écrit par sa PROPRE `connectToPeer`,
  `scenarios/incomingMappingInvariant.test.js`). Une seconde n'y suffisait pas et rien ne réessayait.
  D'où `api.sendDataOnConnection(conn, data)`, contrat dans `docs/modules/webrtc2/api.md`.
  **Leçon pour D2 et D3 : « préserver l'effet de bord » ne veut pas dire « garder le même
  émetteur ». Tout ce qui RÉPOND sur une entrante doit passer par ce verbe.** Effet secondaire
  acquis : le renvoi n'est plus un broadcast — il l'était par emprunt à `handleExcalidrawMouseUp`, et
  comme `updateScene` REMPLACE la scène, à N pairs le dernier écrasait les autres.
  ⚠️ **CE DÉFAUT EST ANTÉRIEUR À D1 — véhicule broadcast ET inatteignabilité de l'arrivant.** Ce
  n'est **pas** une régression de la migration, et il faut le dire ici parce que la forme du
  paragraphe ci-dessus invite à le croire. **La preuve n'est pas recopiée** : elle vit dans
  [whiteboard-todo.md](whiteboard-todo.md) § « Ailleurs, et volontairement pas ici », avec les deux
  pièges de grep qui la rendent recontrôlable — dont un nom de fichier qui **inverse** la conclusion
  si on le lit sans vérifier son appelant.
  *(Rappel de méthode, et c'est la seule chose que ce fichier a besoin de porter : le cas de l'image
  collée, à D1, était lui aussi antérieur à la migration et a failli lui être imputé. **Un défaut
  trouvé PENDANT un lot n'est pas un défaut CAUSÉ par le lot** — la seule façon de le savoir est
  d'aller lire la v1, et une datation qu'on ne peut pas recontrôler sans retomber dans le piège qui
  l'a produite n'est pas une datation.)*
  ℹ️ **D2 n'avait pas à s'en servir, et c'est en soi une information** : son effet de bord ne répond
  pas au pair, il poste vers une iframe **locale**. ✅ **D3 non plus, et pour une raison encore
  différente : il n'a aucun effet de bord de connexion.** Sur les trois appelants data, ce verbe n'a
  donc **qu'un seul** consommateur, D1 — mais il est un contrat du transport, pas une commodité de
  D1 : il vit dans `api.md` et sert tout lot futur qui répond sur une entrante.
- **Sa room n'est pas `room.id`** mais `whiteBoardId` = `room.content[0].id ?? room.id` — l'id du
  vertex de contenu.
- Deux émissions : `update_scene` (mouseup) et `pointer_move`.
- ℹ️ **Un nouveau mode de panne, propre au changement d'accès** : `sendData` était une action de
  store, donc toujours appelable ; `this.$refs.dataBroadcast` vaut `undefined` quand le `v-if` du
  provider est faux, alors que les deux listeners DOM sont posés inconditionnellement en `mounted()`.
  D'où le `?.` aux deux émissions. **Vrai pour les trois modules** — chacun met son provider sous
  `v-if`.
- ℹ️ Laissé tel quel, et signalé : le `handleExcalidrawChange` **commenté** cite encore
  `this.sendData(…, this.room.id)`. Il était déjà périmé avant D1 (la méthode vivante utilise
  `whiteBoardId`) ; il relève de « vider les poches mortes », pas de ce lot.

**D2 · Application** — `Application/ApplicationComponent.vue` — ✅ **MIGRÉ le 01/09/2026** (code,
build et recompte ; la vérification à deux navigateurs reste due)

- ✅ **Le test de sens a été posé aux DEUX sites, et le second n'était pas « indemne »** — la recette
  le disait, et c'était le mot de trop. `onConnectionClose` ne tire qu'une fois **par connexion**,
  mais il tire sur les **deux** connexions de la paire : sans garde, la fermeture de ma sortante
  retire de l'iframe un pair désigné par **mon propre** slug. Un seul prédicat sert les deux sites,
  `isIncomingConnection(conn)`.
- 🔴 **Ce que D2 a appris et que ni D0 ni D1 ne pouvaient dire : `connectionEnabled` n'annonce pas ce
  qu'on croit.** Sur une entrante, elle signifie « ce pair m'a joint », **pas** « je peux lui
  répondre ». `sendData` résout sa connexion **par slug** dans une map qui ne contient que **mes
  sortantes** ; le mapping `slug → peerId` est écrit par ma **propre** `connectToPeer`. Sur le chemin
  présence, où le premier contact est l'entrante de l'autre, ma sortante inverse exige donc un
  aller-retour de signalisation **complet** — l'écart se compte en **secondes**, pas en
  microsecondes (mesuré : `scenarios/incomingMappingInvariant.test.js` et sa table des trois chemins
  d'admission). **Le ✅ de l'iframe est un indicateur d'AFFICHAGE** ; s'en servir pour décider
  d'émettre serait un faux vert. Le protocole documenté ne le fait pas — son ciblage vient des cases
  cochées, pas d'`enabledConnections` — donc rien n'est cassé aujourd'hui : c'est le piège qui est
  écrit, pas un défaut.
- ✅ **L'écart 4 est fermé, et `exclude` survit** : `include` passe tel quel en `destUserSlugs`, le
  complément d'`exclude` se calcule depuis `api.remotePeers.value`, et les deux filtres se cumulent
  comme le faisait le store v1 (`resolveDestinations`). Deux fidélités qui ne se devinent pas :
  `null` ⇒ tous les pairs, mais un tableau **vide** ⇒ **personne**, parce que
  `destUserSlugs || remotePeers` voit un `[]` comme *truthy* — « exclure tout le monde » et
  « n'inclure personne » restent donc fidèles à la v1. Écart de périmètre **assumé** : la v1 partait
  des connexions **ouvertes**, la v2 part des membres **présents** ; un membre sans connexion data
  produit un `console.warn` par slug au lieu d'être ignoré, la livraison est la même.
- ✅ **La régression de sérialisation a été REFERMÉE ici, pas assumée comme à D1** — et c'est le seul
  endroit du lot D où ce choix se posait. La v1 émettait via `safeStringify`, qui rendait `null` sur
  un payload non sérialisable : l'envoi était **sauté**. La v2 émet l'objet tel quel, donc BinaryPack
  **lève**. Or ici le payload ne vient pas du paquet mais d'une **app d'iframe**, écrite hors de tout
  contrôle : une `Map` postMessage-ée ferait lever `conn.send` dans la boucle de diffusion.
  `toTransportable` normalise en données plates avant émission — ce qui part reste un **objet**,
  conforme au contrat v2. ℹ️ **Et ça ne retire rien à personne** : le récepteur passe le message à
  `sendMessageToIframe`, qui fait **déjà** un aller-retour JSON. Rien de non-JSON n'a jamais pu être
  lu en face. C'est la méthode de D1 — lire le récepteur avant de choisir quoi émettre — appliquée
  une seconde fois, et elle répond une seconde fois.
- **Dépend de `conn.metadata.from`** (deux sites : `connectionEnabled` et `connectionDisabled` vers
  l'iframe). v2 fournit le **même champ**, en 3ᵉ argument d'`onDataReceived` — mais il est **absent en
  arité 1** (hub star). Sur une connexion entrante, `from` est le slug du pair distant et `slug` le
  mien.
- ⚠️ Sa prop `room` a un `default: () => {}` dont le corps est vide : elle rend **`undefined`**, donc
  sans prop `room` le `v-if` est faux et le provider ne monte pas. `v-if` gardé tel quel.
- **L'enveloppe d'émission est différente des deux autres** : le module passe le message de l'iframe
  tel quel (`{ action: 'broadcast', data: {…} }`), et `action` est **perdu en route** — le store
  n'émet que `message.data`. Le récepteur reçoit donc `{ event, payload }`, pas `{ action, data }` :
  il n'a pas de `switch(data.action)`, contrairement aux deux autres. **Préservé** :
  `broadcastToPeers` émet `message.data`, l'enveloppe reste de la mécanique locale.
- ℹ️ **Le `<div>` du provider est placé en FIN de wrapper**, après le `div.error`, et non à la place
  de l'ancien tag : la v1 ne rendait aucun nœud, la v2 en rend un, et le voisin est un iframe en
  `height: 100%`. Même geste qu'au Whiteboard, autre emplacement.
- ℹ️ Les deux `console.log('… data chat')` de `connectionDataCallback` ne sont pas reportés : ils
  disaient « chat » dans le module Application.

**D3 · ClassRoom** — `ClassRoom/ClassRoomComponent.vue` — ✅ **MIGRÉ le 01/09/2026** (code, build et
recompte ; la vérification à deux navigateurs reste due)

- ✅ **Le plus petit des trois, et pour une raison qui se mesure : sa v1 ne portait AUCUN effet de
  bord de connexion.** `connectionDataCallback` n'avait que trois `console.log` — non reportés,
  comme les deux d'Application. Conséquence directe : **`onDataReceived` est la seule clé du jeu**,
  et **le garde de sens `isIncomingConnection` ne s'écrit pas ici**. Le piège qui a coûté un
  correctif à D1 et un à D2 ne le concerne pas — c'est le seul des trois dans ce cas.
- ⚠️ **Corollaire sur cette recette : « Lit `conn.connectionId` (journalisation) : inchangé en v2 »
  était un fait sans objet.** Il décrivait une ligne que le lot allait supprimer. Vrai, vérifiable,
  et inutile — une recette peut donc être exacte et quand même faire perdre du temps, en instruisant
  ce qui ne survivra pas à la migration qu'elle décrit.
- ✅ **`JSON.parse` : un seul site dans tout `ClassRoom/`, et c'est bien celui du canal data.** Le
  piège de grep de D2 (quatre `JSON.parse` dont un seul à retirer) **ne s'est pas reproduit** — mais
  il fallait le vérifier pour le savoir, et `ConfigPanel.vue` a été lu au passage : aucune attache au
  store v1.
- ✅ **`mapActions` part entièrement**, à l'inverse de D2 où il devait rester importé pour
  `useApplicationAIStore` : ici son unique site était le `mapActions(usePeerStore, ['sendData'])`.
  Reste `mapState` pour `useMeStore`.
- **Deux émissions** : `whiteboard-toggle` et `chat-toggle`, toutes deux déclenchées par
  `ConfigPanel` depuis un `<Teleport>` sous `v-if="editable"`. D'où le `?.` : le provider est sous
  son propre `v-if`, l'ancien `sendData` était une action de store toujours appelable.
- **Deux providers vivants** : le sien (`room.id`) et celui du Whiteboard qu'il imbrique
  (`subcontent.id`), donc **deux `contextId` distincts** sur le `Peer` singleton. Ils sont
  **frères** dans le template, pas imbriqués l'un dans l'autre : le `provide(WEBRTC_API_KEY)` de
  chacun ne porte que sur son propre slot, vide dans les deux cas.
- **Placement du `<div>`** : en **fin de `.classroom-wrapper`**, pas au niveau racine. C'est le
  troisième emplacement différent des trois lots, et la raison est propre à celui-ci — le composant
  est **multi-racine** (`.classroom-wrapper` + `<Teleport>`), et la v1 y ajoutait un troisième nœud
  qui ne rendait **rien**. Le mettre à la racine ferait passer le composant de **un** à **deux**
  nœuds racine *rendus*, dans un `.room-content-main` qui est lui-même item flex de
  `.room-content-layout`. ℹ️ Mesuré au passage, et rassurant pour la suite : le `<router-view>` de
  `Server/Room.vue:23-28` ne passe que `editable`, `users`, `room` — **trois props déclarées, aucun
  attribut de fallthrough**, donc aucun avertissement Vue lié au multi-racine, ni avant ni après.
- Nécessitait **D1 déjà migré dessous** — c'était le cas.

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
