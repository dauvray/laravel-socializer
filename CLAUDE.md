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

**`docs/` ne contient que du définitif** : architecture, conventions, référence, rationale.
**`work/` contient le suivi de chantier** : todo, audits, plans de tests.

> **Une case à cocher ⇒ le fichier appartient à `work/`.**
> **Aucun chiffre volatil dans `docs/`** — décomptes de tests, occurrences, avancement.

Ces règles et le modèle de doc de module : [docs/ecrire-la-doc.md](docs/ecrire-la-doc.md).
Quand un chantier se termine, remonter le durable dans `docs/` et supprimer le reste — l'historique
est dans git.

---

## Ce que le paquet dit de lui-même aux projets hôtes

`resources/boost/guidelines/core.blade.php` est **livré avec le tag** et injecté par
`php artisan boost:update` dans le `CLAUDE.md` de chaque projet qui installe le paquet. Il ne contient
qu'un routeur — 5 lignes toujours visibles (v1 morte, alias `~socializer`, « lire ce fichier ») et un
bloc `@scoped(['vendor/dauvray/laravel-socializer/**'])` avec les pièges qui ne mordent qu'une fois
dans le paquet.

> **La substance reste ici, dans `docs/`.** Le routeur ne doit jamais grossir : deux copies d'un même
> fait divergent. Si une règle mérite d'être connue de tous les projets hôtes, elle est courte, ou
> elle est un pointeur.

`socializer:build` déclare le paquet auprès de Boost (`boost.json`) puis relance `boost:update` : un
projet consommateur n'a rien à câbler à la main.

---

## À savoir avant de conclure quoi que ce soit

- **La sécurité WebRTC2 n'est pas « faite », mais le backend l'est désormais en grande partie** :
  les deux sens sont durcis côté client, et le backend porte un `throttle` à **deux buckets**
  (les 5 routes n'ont pas la même cadence légitime), un `validate()` sur les 5 payloads et un
  contrôle de relation émetteur ↔ destinataire en 403 uniforme — épinglés par
  `tests/Feature/Signaling/` et `tests/Feature/Profile/`.
  **Les gardes de canal ne lisent plus l'appartenance à un groupe dans NebulaGraph** (24/08/2026) :
  le graphe en est un réplica qui dérive **dans le sens qui accorde**, MariaDB en est le maître.
  Arbitrage écrit dans [securite.md](docs/modules/webrtc2/securite.md), piège 2 — le lire avant de
  proposer d'y ajouter une re-synchronisation.
  **La liste de contacts applique le même prédicat depuis le 25/08/2026** : `getUsersList` rendait
  tous les utilisateurs actifs à tout authentifié, elle est restreinte aux **joignables** sauf
  permission `list_users`. Son prédicat en lot (`reachableVertexIds`) doit dire exactement ce que
  `mayReach` dit à l'unité — un test compare les deux, ne pas les faire diverger.
  **Reste ouvert** : l'usurpation intra-room par un membre qui se présente avec un peerId neuf
  sous le slug d'un autre — les deux chemins ont la même signature locale, ce n'est pas fermable
  côté client. Les credentials TURN sont sortis du bundle
  **et sont désormais éphémères** (TURN REST API, signés par utilisateur, TTL 24 h) : un abus est
  attribuable et révocable. Borne restante : le navigateur ne demande la configuration ICE qu'une
  fois par onglet, donc un onglet ouvert au-delà du TTL n'ouvre plus de nouvelle allocation. Voir
  [docs/modules/webrtc2/securite.md](docs/modules/webrtc2/securite.md).
- **La suite PHP couvre la signalisation WebRTC et les gardes d'autorisation de `Socializable`** —
  un socle, pas un filet.
  Ses cinq décisions de harnais (pile de middlewares réduite, aucune migration du paquet, doublures
  qui lèvent) sont dans [docs/architecture/tests.md](docs/architecture/tests.md#suite-php--dans-le-package-via-orchestra-testbench) : les
  ignorer coûte une demi-journée.
- **Le front est en français en dur**, sans `$t()`. Introduire l'i18n est un chantier à part entière.
- Plusieurs zones sont mortes ou vides (`admin.php` commenté, `console.php` vide, `table_names`
  vide, `socializer:upgrade` quasi entièrement commenté) —
  [liste](docs/architecture/package.md#zones-mortes-connues).
