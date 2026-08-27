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
   > ⚠️ Depuis le 28/08, **le premier 🔴 de [sass-todo.md](sass-todo.md) appartient à ce chantier** :
   > la vignette d'attente est correcte dans le DOM et invisible à l'écran. Tant qu'il tient, aucune
   > vérification visuelle de l'annonce de diffusion ne peut conclure quoi que ce soit.
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
| [webrtc2-todo.md](webrtc2-todo.md) | ouvert, **deux 🔴 neufs** | items de pérennisation du module : sémantique de `peerInitPromise`, machine à états du cycle de vie du `Peer`, ce qui reste de la chaîne de présence ouverte par le bail des peerId — trois verrous fermés (verrou coalescent et purge d'une room qui se vide le 27/08, fan-out qui réconcilie le 28/08), restent la re-composition sur fermeture de connexion, la fraîcheur de `roomMembers` et le client star qui compose un hub absent, **désormais couplé** au précédent — renommage de `usersInRoom`, observabilité. La section « Annonce de diffusion » porte le résultat de la **vérification à deux onglets, faite le 28/08** : le champ `isBroadcasting` arrive en 592 ms et le front le rend en 15 ms (verdict positif sur `10d634f`), contre-épreuve tenue sous contrôle positif — mais elle a sorti **deux 🔴**. (1) **fenêtre 3** : un peerId déjà connu sous bail ne redemande rien, donc ne porte pas l'annonce ⇒ vignette à 8,8 s ou jamais, et c'est le cas majoritaire (navigation SPA) ; l'option `whisper` écartée y **reprend de la valeur**, l'arbitrage est réécrit. (2) **la vignette n'est jamais visible** : `.draggable-video` sans `<video>` s'effondre à 0 px et le parent `overflow-hidden` clippe le label — défaut CSS, à traiter avec [sass-todo.md](sass-todo.md). Plus un `[L]` **gelé** — déplacer le routage star dans `usePeerTransport` — qui **bloque les tâches 6 et 7** du plan de tests. |
| [webrtc2-tests-plan.md](webrtc2-tests-plan.md) | ouvert, bien avancé | avancement par fichier et trous restants (`sendData` star, câblage du rate-limit hub, `contextRegistry`, `usePeerCore` partiel). Porte les pièges de harnais mesurés — les lire avant d'écrire un test de ce module. |
| [doc-rustines.md](doc-rustines.md) | 🟠 démarré — **lot 0 terminé** | rendre la doc exempte d'annotations qui compensent un défaut du code. Le lot 0 (annotations déjà fausses) est fermé. Vient ensuite la v1 WebRTC, déclarée morte mais **encore importée par cinq composants vivants**. |
| [projection-graphe-todo.md](projection-graphe-todo.md) | ⏸️ **suspendu — au besoin seulement** | suites du correctif « un utilisateur = un mur + un feed ». Rien n'y bloque ; deux items portent une exigence d'exploitation (sauvegarder le space NebulaGraph, que rien ne reconstruira). |
| [chat-tests-plan.md](chat-tests-plan.md) | **non démarré** | plan de tests du Chat en 5 couches. Un seul fichier de test existe. Une décision en attente : helpers dédiés ou partagés (`mockEcho`, `mockRoute`, `seedChatStore`). |
| [front-todo.md](front-todo.md) | **non démarré** | deux items. Le ping d'ouverture de session part avant que pusher n'ait confirmé l'abonnement, et Reverb le rejette — l'utilisateur peut rester hors ligne deux minutes ; le correctif naïf (`subscribed(cb)`) ne part jamais sur un canal déjà confirmé. Et `isEmpty(element.store)` lève sur un commentaire de post chargé par la liste, **dans un listener Reverb donc en silence** — quatre appelants, deux étages possibles pour le correctif. |
| [sass-todo.md](sass-todo.md) | **non démarré**, un 🔴 neuf | un **🔴 ajouté le 28/08** qui n'est pas de la dette de style mais une fonctionnalité invisible : `.video-loading` sans `<video>` s'effondre à 0 px et le parent `overflow-hidden` clippe la vignette d'attente. Puis le reste : thème sombre cassé par des couleurs en dur, absence de `_variables.scss` propre au paquet (arbitrage A/B à trancher), URL d'image externe en prod, et les `@extend` de classes Bootstrap à migrer. |
