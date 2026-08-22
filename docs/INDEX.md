# Documentation — `dauvray/laravel-socializer`

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

## Les cinq choses qui coûtent le plus cher à réapprendre

1. **`components/WebRTC/` (sans le 2) est mort.** L'implémentation vivante est `WebRTC2/`. Un
   symbole trouvé au grep peut venir de la v1.
2. **Les tests JS se lancent depuis la racine du projet hôte**, pas depuis le package — il n'a ni
   `package.json` ni `node_modules`.
3. **`type` ≠ `connectionType`** dans la signalisation. Le premier est une clé de routage ; les
   confondre envoie la réponse dans une file que personne n'observe.
4. **Le routage des signaux ne pose aucune précondition** — c'est un invariant, pas un oubli. En
   ajouter une a déjà fait disparaître des flux, de façon intermittente.
5. **L'audit sécurité de mai n'était pas « clôturé »** : son périmètre était le sens entrant. Le sens
   sortant n'a aucun contrôle d'autorisation.
