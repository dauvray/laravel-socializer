# TODO — Serveurs

> **Chantier ouvert.** Items propres au module Serveur, hors WebRTC2 et hors chat.
> Le définitif vit dans [`docs/`](../docs/INDEX.md).

---

## 🔴 `nb_users` est faux sur un serveur privé `[M]`

- [ ] **Découvert le 21/08/2026**, en voulant afficher « combien de membres ont accès » à côté du
      compteur de présence.

`Services/Server::getServer` renvoie `nb_users`, censé être le nombre de membres du serveur. Sa
requête nGQL laisse **une seule clause faire deux métiers** — « ai-je le droit de voir ce
serveur ? » et « qui sont ses membres ? » :

```
MATCH (o:user)<-[:has_creator]-(g:group)<-[:owned_by]-(s:server), (u:user)-[:registered_in]->(g)
WHERE id(s) == '$vertex_id'
  AND (s.server.privacy == 0 OR (s.server.privacy == 1 AND id(u) == '$user_vertexid'))
… count(distinct u) as nb_users
```

Sur `privacy == 1`, la clause restreint `u` — **le membre qu'on compte** — au demandeur. L'ensemble
des membres se réduit donc à `{moi}` et `nb_users` vaut **toujours 1**. Sur `privacy == 0` elle ne
restreint rien et le compte est juste.

Mesuré sur `0e64e1713d940` (« Innovation », `privacy = 1`, 2 membres réels) :

```
vu par admin    => nb_users = 1
vu par joe-bar  => nb_users = 1
membres réels   => 2
```

C'est le motif de la leçon C2 du chantier sécurité, appliqué à un compteur : **un garde doit
conditionner le résultat entier, jamais l'ensemble qu'on énumère dedans.**

- Sortir l'accès de la clause de comptage : prédicat distinct (serveur public **ou** demandeur
  membre du groupe) qui décide de rendre `false`, puis compter les membres sans restriction.
- ⚠️ **Sous-évaluer n'est pas fuir** : le bug actuel ne divulgue rien. Le correctif, lui, touche la
  visibilité d'un serveur privé — il ne vaut qu'accompagné de son test de non-régression.

**Tests :** un membre d'un serveur privé voit le vrai nombre de membres · un **non**-membre ne voit
toujours pas le serveur (404/`false`, inchangé) · un serveur public reste juste.
**Commit :** `fix(socializer): compter les membres d'un serveur privé sans se restreindre au demandeur`

Bloque l'affichage « N membres ont accès » dans le dropdown de présence de `ServerParamsButton` :
afficher 1 quand il y en a 2 serait pire que de ne rien afficher.

---

## 🟡 Présence ≠ activité — arbitrage produit `[M]`

- [ ] **Dépend de :** rien. À trancher avant d'écrire quoi que ce soit.

Le compteur de `ServerParamsButton` affiche les souscriptions au canal `server.{serverId}`, donc
**des onglets ouverts**. Une fenêtre oubliée sur la page serveur est comptée comme présente — c'est
ce qui a fait passer un compteur juste pour un bug le 21/08 (le tour complet du diagnostic est dans
[`docs/architecture/signalisation.md`](../docs/architecture/signalisation.md#ce-que-la-présence-mesure--un-onglet-ouvert)).

Le transport ne peut pas savoir mieux : « présent » y signifie « un client tient une souscription ».
Distinguer présent / inactif demande un mécanisme en plus — `visibilitychange` côté client + un
whisper d'inactivité sur le canal, et un état `away` dans la liste.

**Décision attendue avant tout code :** est-ce que « présent » doit vouloir dire *onglet ouvert*
(comportement actuel, gratuit) ou *fenêtre au premier plan* (à construire) ? Les deux se défendent ;
seul le libellé doit cesser de mentir sur celui qui est retenu.
