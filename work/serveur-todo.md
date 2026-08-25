# TODO — Serveurs

> **Chantier ouvert.** Items propres au module Serveur, hors WebRTC2 et hors chat.
> Le définitif vit dans [`docs/`](../docs/INDEX.md).

---
**`nb_users` faux sur un serveur privé** est fermé (24/08/2026), en livrant la sortie de la
décision d'accès hors de la clause de comptage — le défaut de comptage et le défaut d'accès
étaient la même clause. La règle générale et son delta assumé sont remontés dans
[`docs/modules/webrtc2/securite.md`](../docs/modules/webrtc2/securite.md#deux-pièges-du-graphe-que-ce-garde-contourne),
le piège de harnais dans
[`docs/architecture/tests.md`](../docs/architecture/tests.md#les-décisions-du-harnais).

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
