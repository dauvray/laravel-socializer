# TODO — Front transverse (hors module)

> **Chantier ouvert.** Items front qui ne relèvent d'aucun module. Les faits durables
> correspondants sont déjà dans `docs/` — ce fichier ne porte que ce qui reste à faire.

## Le ping d'ouverture de session court contre la confirmation d'abonnement (26/08/2026)

Les quatre whispers de départ et le battement de présence passent désormais tous par
`useReverbChannel` — la contrainte d'ordre qui les fait partir est dans
[`docs/reference/use-reverb-channel.md`](../docs/reference/use-reverb-channel.md#un-whisper-de-départ-senregistre-avant-le-composable),
épinglée par deux `describe` de `components/System/composables/__tests__/useReverbChannel.test.js`.

Reste une course **antérieure et indépendante**, trouvée en vérifiant ce routage.

`System/Notifications.vue` whispere `ping` depuis un `watch(me)` placé sous l'appel au composable :
le `join()` passe donc bien en premier. Mais **joindre n'est pas être abonné.** `Echo.private(name)`
rend l'objet canal tout de suite ; pusher, lui, confirme l'abonnement par un aller-retour. Entre les
deux, `Channel.trigger` journalise `Client event triggered before channel 'subscription_succeeded'`
et **émet quand même** — et Reverb rejette un client event sur un canal non confirmé.

Ce que ça coûte quand la course est perdue : le ping d'ouverture ne compte pas, et l'utilisateur
n'apparaît en ligne qu'au battement suivant. Or l'intervalle du heartbeat (120 000 ms,
`Notifications.vue`) **égale** le TTL Redis de la présence (`now()->addMinutes(2)`,
`app/Services/OnlineUsersService.php`) : il n'y a aucune marge, la fenêtre est de deux minutes
pleines.

Le piège à connaître avant d'y toucher : **`PusherChannel.subscribed(cb)` est un écouteur
d'événement, pas une promesse.** Branché après coup sur un canal déjà confirmé, le rappel ne part
**jamais** — un correctif naïf transformerait une course perdue une fois sur deux en ping jamais
émis. Il faut tester l'état d'abord, puis s'abonner.

- [ ] Faire partir le ping d'ouverture **à** la confirmation d'abonnement, en gardant le cas
      déjà-confirmé. Deux voies : un `channel()?.subscribed(…)` gardé côté `Notifications.vue`, ou
      une option `onSubscribed` dans `useReverbChannel` — la seconde profiterait aux quatre autres
      consommateurs et éviterait de rouvrir l'échappatoire `channel()`.
- [ ] **La vérification est sur un vrai Reverb**, pas en test : aucune doublure ne prouve un
      aller-retour d'abonnement. Se connecter, et regarder si l'utilisateur apparaît en ligne
      immédiatement ou au bout de deux minutes.

## `isEmpty(element.store)` lève sur un commentaire de post (26/08/2026)

Trouvé en écrivant `components/Feed/__tests__/feedLifecycle.test.js` : la fixture de l'événement
`FeedActivity` **doit** porter un `store` non-nul, sinon le listener Reverb lève. Ce n'est pas un
artefact de test — c'est un chemin de production.

`isEmpty` (`~estarter/services/helpers.js:299`) fait `Object.keys(obj).length === 0` **sans garde** :
`null` et `undefined` y lèvent. Or il est appelé sur `element.store` à quatre endroits, tous sur le
même champ :

| Appelant | Ligne |
|---|---|
| `stores/feed/actions.js` — `commentCreatedTrigger` / `commentDeletedTrigger` | 138, 156 |
| `stores/comments/actions.js` — insertion et suppression | 98-99, 139-140 |

**Deux formes de `store` circulent, et une seule est sûre.** À la création, `Comments::createCommment`
pose explicitement `'store' => isset($result[0]) ? $result[0]['storeId'] : []` — la liste vide est
choisie exprès, et `isEmpty([])` vaut `true`. Mais un commentaire **chargé par la liste** vient de
`Comments::getComments`, dont le `RETURN … id(p) as store` est alimenté par un
`OPTIONAL MATCH (c)-[ff:reply_of]->(p)` : pour un commentaire de POST, `c` est le post, il ne
`reply_of` rien, et `p` n'est jamais apparié. Le `store` rendu n'est alors pas `[]` — c'est ce que le
pilote NebulaGraph produit pour un `id()` non apparié.

Ce que ça coûte : supprimer un commentaire de post chargé par la liste fait partir un
`comment.deleted` que **tous les autres spectateurs du feed** reçoivent, et `commentDeletedTrigger`
lève chez eux — **dans un listener Reverb, donc en silence**. Leur compteur de commentaires cesse
d'être à jour jusqu'au rechargement de la page. Les deux sérialisations plausibles cassent, par deux
chemins différents : `null` lève dans `isEmpty`, et `"__NULL__"` passe pour un vrai storeId puis fait
lever `commentStore.commentables["__NULL__"].data.forEach`.

- [ ] **D'abord observer, pas corriger** : créer un commentaire de post, le lister, et regarder ce
      que `store` vaut réellement dans la réponse de `/get-comments/…`. Le correctif dépend de la
      valeur — et une doublure ne peut pas la produire, elle vient du pilote NebulaGraph.
- [ ] Corriger **au bon étage**. Deux voies, exclusives : durcir `isEmpty` côté estarter (touche
      tous ses appelants, hors de ce paquet), ou normaliser `store` à la sortie de `getComments`
      comme `createCommment` le fait déjà — la seconde garde la faute là où elle naît et rend les
      deux chemins identiques.
- [ ] Épingler par un test **les quatre appelants**, pas seulement celui du feed : le motif est
      copié à l'identique dans `stores/comments/actions.js`, et corriger un seul étage y laisserait
      la même panne.
