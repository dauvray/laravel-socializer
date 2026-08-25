# laravel-socializer

Réseau social + communication temps réel pour Laravel — murs, fils, commentaires, serveurs et
rooms, chat, visio/diffusion WebRTC, tableau blanc, applications IA.
**Laravel 13 · Vue 3 + Pinia · MySQL + MongoDB + NebulaGraph.**

**Ce fichier ne fait que router.** Le contenu est dans [`docs/`](docs/INDEX.md).

---

## Les quatre pièges qui coûtent cher

1. **`components/WebRTC/` (sans le 2) est mort.** L'implémentation vivante est
   `components/WebRTC2/`. Les deux coexistent dans l'arbre et ont des fichiers homonymes
   (`MediaBroadcastProvider.vue`) — un symbole trouvé au grep peut venir de la v1.
2. **Les tests JS se lancent depuis la racine du projet hôte**, jamais depuis le package : il n'a ni
   `package.json` ni `node_modules`, tout l'outillage front vit côté hôte. Depuis ce dossier,
   `cd ../../..`. Le package a en revanche son **propre dépôt git** et sa propre suite PHP.
3. **Imports front toujours via l'alias `~socializer`**, jamais en relatif profond. L'alias est
   défini côté hôte dans `vite.config.js` **et** `vitest.config.js` ; un relatif casserait l'un des
   deux.
4. **Namespaces PHP en casse mixte, assumée** : `Dauvray\Socializer\app\Models\Post`,
   `Dauvray\Socializer\app\console\Commands\…`. Non-idiomatique mais systématique — le reproduire.

---

## Commandes

```bash
# Tests JS — DEPUIS LA RACINE DU PROJET HÔTE (cd ../../.. depuis ce paquet)
npm run test:run

# Tests PHP — DEPUIS CE PAQUET (Orchestra Testbench, aucun serveur requis)
composer install && vendor/bin/phpunit

# Installation / mise à jour du package dans l'app (publish + migrate + seed + patch de fichiers)
php artisan socializer:build

# Activer le hook qui refuse de pousser une suite rouge (une fois, dans ce dépôt)
git config core.hooksPath hooks
```

---

## Où lire quoi

| Pour… | Lire |
|---|---|
| **tout le reste** — index complet, routage par intention | [docs/INDEX.md](docs/INDEX.md) |
| comprendre le package en arrivant | [docs/architecture/package.md](docs/architecture/package.md) |
| écrire du code qui ressemble au reste | [docs/architecture/conventions.md](docs/architecture/conventions.md) |
| ajouter un événement temps réel / un canal Reverb | [docs/architecture/signalisation.md](docs/architecture/signalisation.md) |
| lancer ou écrire des tests | [docs/architecture/tests.md](docs/architecture/tests.md) |
| **WebRTC2** — le module le plus dense | [docs/modules/webrtc2/INDEX.md](docs/modules/webrtc2/INDEX.md) |
| le ChatComponent | [docs/modules/chat.md](docs/modules/chat.md) |
| situer un autre module front | [docs/modules/autres-modules.md](docs/modules/autres-modules.md) |
| **ce qui reste à faire** | [work/README.md](work/README.md) |
| installer le package dans une app | [README.md](README.md) |

---

## `docs/` vs `work/`

`docs/` = définitif · `work/` = suivi de chantier. **Une case à cocher ou un chiffre volatil ⇒ le
fichier appartient à `work/`.** La règle entière, le modèle de doc de module et le geste de clôture
d'un chantier : [docs/ecrire-la-doc.md](docs/ecrire-la-doc.md).

---

## Ce que le paquet dit de lui-même aux projets hôtes

`resources/boost/guidelines/core.blade.php` est **livré avec le tag** et injecté par `boost:update`
dans le `CLAUDE.md` de chaque projet hôte. C'est un **routeur** : une coupe dedans retire le fait de
tous les projets qui installeront ce tag, et il ne doit jamais grossir — la substance reste dans
`docs/`. `socializer:build` déclare le paquet auprès de Boost puis relance `boost:update`.

---

## À savoir avant de conclure quoi que ce soit

- **La sécurité WebRTC2 n'est pas « faite »** — mais elle n'est pas non plus ouverte : le périmètre
  réel, ce qui est durci **dans quel sens**, les bornes assumées et ce qui reste ouvert sont dans
  [securite.md](docs/modules/webrtc2/securite.md), qui ouvre sur une table faite pour ça. **Ne rien
  conclure de l'état de la sécurité sans l'avoir lue** : c'est le seul endroit qui distingue « durci
  en sortie » de « durci en entrée », et deux propositions naturelles y sont explicitement écartées
  (re-synchroniser le réplica graphe ; contrôler le `contextId` d'une invitation en vol).
- **La suite PHP est un socle, pas un filet** : elle couvre la signalisation WebRTC et les gardes
  d'autorisation de `Socializable`. Ses décisions de harnais sont contraintes par l'état réel du
  paquet et les défaire sans les lire coûte une demi-journée —
  [tests.md](docs/architecture/tests.md#suite-php--dans-le-package-via-orchestra-testbench).
- **Zones mortes ou vides** (`admin.php` commenté, `console.php` vide, `table_names` vide,
  `socializer:upgrade` quasi entièrement commenté) :
  [liste](docs/architecture/package.md#zones-mortes-connues).
