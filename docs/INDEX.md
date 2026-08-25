# Documentation — `dauvray/laravel-socializer`

> **À quoi ça sert :** router vers le bon fichier de `docs/` selon l'intention.
> **Quand le lire :** en arrivant, et chaque fois qu'on cherche où un fait est écrit.

Réseau social + communication temps réel pour Laravel 13 / Vue 3.
Point d'entrée court : [`CLAUDE.md`](../CLAUDE.md) · Installation : [`README.md`](../README.md)

**`docs/` ne contient que du définitif.** Ce qui est en cours vit dans
[`work/`](../work/README.md) — voir [ecrire-la-doc.md](ecrire-la-doc.md).

---

## Je veux…

| Intention | Lire |
|---|---|
| **comprendre le package** en arrivant | [architecture/package.md](architecture/package.md) |
| écrire du code qui ressemble au reste | [architecture/conventions.md](architecture/conventions.md) |
| ajouter un événement temps réel, un canal Reverb | [architecture/signalisation.md](architecture/signalisation.md) |
| **projeter des données dans NebulaGraph**, ou réparer un graphe qui a divergé | [architecture/projection-graphe.md](architecture/projection-graphe.md) |
| comprendre la couture NebulaGraph : qui lève, qui journalise, **et pourquoi une session refusée se rejoue** | [architecture/signalisation.md](architecture/signalisation.md#la-session-nebulagraph-est-partagée-recyclée-et-un-processus-long-doit-y-survivre) |
| lancer ou écrire des tests | [architecture/tests.md](architecture/tests.md) |
| **brancher la visio / le chat data / la diffusion** | [modules/webrtc2/api.md](modules/webrtc2/api.md) |
| comprendre pourquoi un flux WebRTC n'arrive pas | [modules/webrtc2/flux.md](modules/webrtc2/flux.md) |
| ajouter un composable WebRTC2 sans casser le graphe | [modules/webrtc2/architecture.md](modules/webrtc2/architecture.md) |
| savoir qui voit quoi (hub star, E2E, périmètre des audits) | [modules/webrtc2/securite.md](modules/webrtc2/securite.md) |
| écrire un test WebRTC2, ou comprendre un test vert à tort | [modules/webrtc2/tests.md](modules/webrtc2/tests.md) |
| toucher au ChatComponent | [modules/chat.md](modules/chat.md) |
| situer un autre module front | [modules/autres-modules.md](modules/autres-modules.md) |
| **souscrire à un canal Reverb** dans un composable | [reference/use-reverb-channel.md](reference/use-reverb-channel.md) |
| savoir ce qui reste à faire | [`work/README.md`](../work/README.md) |
| ajouter de la doc | [ecrire-la-doc.md](ecrire-la-doc.md) |

---

## Arborescence

```
docs/
├── INDEX.md                        ce fichier
├── ecrire-la-doc.md                la convention documentaire + modèle de doc de module
├── architecture/                   transverse au package
│   ├── package.md                  identité, tri-persistance, ServiceProvider, points d'extension
│   ├── conventions.md              PHP · front · Pinia · SCSS · i18n
│   ├── signalisation.md            Reverb/Echo, canaux, 5 events, file de signaux
│   ├── projection-graphe.md        qui écrit le réplica NebulaGraph, l'invariant, la réparation
│   └── tests.md                    infra Vitest (côté hôte), stratégie, hook pre-push
├── modules/
│   ├── webrtc2/                    INDEX · architecture · flux · api · securite · tests
│   ├── chat.md
│   └── autres-modules.md           fiches courtes des 15 autres modules front
└── reference/
    └── use-reverb-channel.md       API de useReverbChannel / useReverbPresence
```

---

## Ce qui coûte le plus cher à réapprendre

Les pièges d'arrivée — v1 morte, où lancer les tests, l'alias `~socializer`, la casse des
namespaces — sont dans [`CLAUDE.md`](../CLAUDE.md), qui mène ici. Ce qui suit ne s'y trouve pas :

- **`type` ≠ `connectionType`** dans la signalisation. Le premier est une clé de routage ; les
  confondre envoie la réponse dans une file que personne n'observe —
  [signalisation.md](architecture/signalisation.md#type-vs-connectiontype--ne-jamais-les-confondre).
- **Le routage des signaux ne pose aucune précondition** — c'est un invariant, pas un oubli. En
  ajouter une a déjà fait disparaître des flux, de façon intermittente.
- **Ne rien conclure de l'état de la sécurité WebRTC2 sans lire son périmètre réel.** Les deux sens
  portent un garde d'autorisation, mais ils n'ont pas la même histoire et pas la même couverture, et
  plusieurs bornes sont assumées plutôt que fermées :
  [securite.md](modules/webrtc2/securite.md).
