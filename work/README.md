# Chantiers en cours

> **Ce dossier n'est pas de la documentation.** Il porte le suivi de travail : todo, audits,
> plans de tests, notes de chantier. Cases à cocher, chiffres et dates y sont les bienvenus.
> Le définitif vit dans [`docs/`](../docs/INDEX.md) — la règle de partage et le geste de clôture
> d'un chantier sont dans [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md).

Rien ici n'est à charger par défaut. On l'ouvre quand on reprend le chantier concerné.

**Chaque ligne du tableau dit ce qu'il faut pour DÉCIDER d'ouvrir le fichier, et rien de plus.**
Le détail est dans le fichier ; le récit est dans `git log`.

---

## Ordre de priorité

Aucun chantier ne passe devant les autres. L'ordre par défaut, tant que rien n'est demandé
explicitement :

1. Le module WebRTC2 au fil de l'eau : [webrtc2-todo.md](webrtc2-todo.md),
   [webrtc2-tests-plan.md](webrtc2-tests-plan.md).
   > ✅ **Plus aucun 🔴 dans ce chantier depuis le 28/08.** Les deux sont tombés le même jour : la
   > vignette invisible à l'écran, puis la fenêtre 3 — le cas majoritaire (navigation SPA sous bail
   > de peerId) qui n'apprenait jamais qu'un pair diffuse, fermée par un quatrième chemin d'annonce
   > (whisper sur le canal de présence). Restent des items de pérennisation, tous 🟢/🟠.
2. [doc-rustines.md](doc-rustines.md) — le volet de ce paquet dans le chantier transverse. L'ordre
   des lots est fixé par [le `work/` du projet hôte](../../../../work/README.md).

> ⏸️ **[projection-graphe-todo.md](projection-graphe-todo.md) est suspendu — au besoin seulement.**
> Ses items restants sont 🟢/🟠 et ne bloquent rien. **Ne pas le rouvrir parce qu'une lecture de code
> y ramène** : y verser un constat sans rouvrir le chantier est l'usage prévu. La raison de la
> prudence est dans son en-tête — chaque item y *paraît* petit et adjacent au précédent, et c'est
> exactement comme la dérive s'est produite.

---

| Fichier | État | En une phrase |
|---|---|---|
| [webrtc2-todo.md](webrtc2-todo.md) | ouvert, **aucun 🔴** | items de pérennisation du module : sémantique de `peerInitPromise`, machine à états du cycle de vie du `Peer`, ce qui reste de la chaîne de présence ouverte par le bail des peerId — reste la fraîcheur de `roomMembers` —, observabilité. **La migration de `remotePeers` vers Pinia est close le 29/08** : `roomMembers[contextId]` est la source unique, `connection.remotePeers` un accesseur en lecture seule au-dessus d'elle (donc ~25 lectures de production et ~55 semis de test inchangés), et `_diffLock` est parti. L'énoncé promettait l'atomicité et la réactivité : les deux étaient déjà là — le gain réel est un chemin d'écriture unique vers l'allowlist des deux gardes d'autorisation. La passe a réfuté la consigne de l'item de fraîcheur voisin, qui reste ouvert : un TTL sur l'entrée fermerait silencieusement l'allowlist d'une room calme, la péremption appartient à la lecture d'`isUserInAnyRoom`. Et la parade contre le mode de panne silencieux est devenue permanente — aucun setter en production, plus un grep qui interdit d'en réintroduire un. **Le renommage de `usersInRoom` en `remotePeers` est clos le 28/08** : le nom promettait « les membres de la room » et livrait les seuls pairs distants, à l'endroit précis où il sert d'allowlist aux deux gardes d'autorisation. L'énoncé voulait garder un `usersInRoom` neutre — écarté, aucun lecteur ne le voulait, et il aurait rendu au nom le sens inverse du sien sans lever d'erreur ; le computed compensatoire `allUsersInRoom` est supprimé, pas renommé. La passe garde sa parade au mode de panne silencieux d'un renommage de champ de `connection`. **Le client star qui composait un hub absent est clos le 28/08** : la branche client est devenue la branche mesh filtrée sur le hub, ce que seule la réconciliation du fan-out rendait possible — le couplage annoncé s'est vérifié. Elle a emporté un second défaut absent de l'énoncé, le `preserveRetry` manquant, et écarté `isHubConnected`, qui ne disait que la moitié du prédicat. La **re-composition sur perte de connexion** est close le 28/08 : elle ferme le dernier cas de la chaîne de présence, celui où aucun tour n'a lieu du tout, et elle a réfuté l'énoncé de son propre item — `handleRemoteDeparture` ne voit jamais une fermeture sortante, donc aucune frontière de couche n'était en jeu. La section « Annonce de diffusion » est **close le 28/08** : ses trois fenêtres sont fermées par un quatrième chemin, le whisper sur le canal de présence, seul porteur indépendant de la signalisation P2P. Elle garde les trois faits appris en le posant — dont « une clé `accept_client_events_from` absente vaut `'all'` » et la course annonce/annuaire — et nomme la seule borne restante, qui est d'affichage et assumée. Plus un `[L]` **gelé** — déplacer le routage star dans `usePeerTransport` — qui **bloque les tâches 6 et 7** du plan de tests. |
| [webrtc2-tests-plan.md](webrtc2-tests-plan.md) | ouvert, bien avancé | avancement par fichier et trous restants (`sendData` star, câblage du rate-limit hub, `contextRegistry`, `usePeerCore` partiel). Porte les pièges de harnais mesurés — les lire avant d'écrire un test de ce module. |
| [doc-rustines.md](doc-rustines.md) | 🟠 démarré — **lot 0 terminé** | rendre la doc exempte d'annotations qui compensent un défaut du code. Le lot 0 (annotations déjà fausses) est fermé. Vient ensuite la v1 WebRTC, déclarée morte mais **encore importée par cinq composants vivants**. |
| [projection-graphe-todo.md](projection-graphe-todo.md) | ⏸️ **suspendu — au besoin seulement** | suites du correctif « un utilisateur = un mur + un feed ». Rien n'y bloque ; deux items portent une exigence d'exploitation (sauvegarder le space NebulaGraph, que rien ne reconstruira). |
| [chat-tests-plan.md](chat-tests-plan.md) | **non démarré** | plan de tests du Chat en 5 couches. Un seul fichier de test existe. Une décision en attente : helpers dédiés ou partagés (`mockEcho`, `mockRoute`, `seedChatStore`). |
| [front-todo.md](front-todo.md) | **non démarré** | deux items. Le ping d'ouverture de session part avant que pusher n'ait confirmé l'abonnement, et Reverb le rejette — l'utilisateur peut rester hors ligne deux minutes ; le correctif naïf (`subscribed(cb)`) ne part jamais sur un canal déjà confirmé. Et `isEmpty(element.store)` lève sur un commentaire de post chargé par la liste, **dans un listener Reverb donc en silence** — quatre appelants, deux étages possibles pour le correctif. |
| [sass-todo.md](sass-todo.md) | **non démarré** | de la dette de style, et seulement ça depuis que le 🔴 « vignette d'attente invisible » est parti dans le chantier WebRTC2 qui l'avait produit (fermé le 28/08, sans rien devoir à ce fichier). Restent : thème sombre cassé par des couleurs en dur, absence de `_variables.scss` propre au paquet (arbitrage A/B à trancher), URL d'image externe en prod, et les `@extend` de classes Bootstrap à migrer. |
