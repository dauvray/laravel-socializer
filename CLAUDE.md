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
2. **Les tests tournent depuis `/var/www/estarter-test`**, la racine du projet **hôte**. Le package
   n'a ni `package.json` ni `node_modules` : il est développé directement dans `vendor/`, avec son
   propre dépôt git.
3. **Imports front toujours via l'alias `~socializer`**, jamais en relatif profond. L'alias est
   défini côté hôte dans `vite.config.js` **et** `vitest.config.js` ; un relatif casserait l'un des
   deux.
4. **Namespaces PHP en casse mixte, assumée** : `Dauvray\Socializer\app\Models\Post`,
   `Dauvray\Socializer\app\console\Commands\…`. Non-idiomatique mais systématique — le reproduire.

---

## Commandes

```bash
# Tests JS — DEPUIS LA RACINE DU PROJET HÔTE
cd /var/www/estarter-test && npm run test:run

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

## À savoir avant de conclure quoi que ce soit

- **La sécurité WebRTC2 n'est pas « faite »** : les deux sens sont durcis **côté client**, mais le
  **backend** n'a ni throttle, ni validation, ni contrôle de relation — et c'est lui qui porte la
  seule fermeture possible de l'usurpation intra-room. Voir
  [docs/modules/webrtc2/securite.md](docs/modules/webrtc2/securite.md).
- **La suite PHP ne couvre que la signalisation WebRTC** — c'est un socle tout neuf, pas un filet.
  Ses cinq décisions de harnais (pile de middlewares réduite, aucune migration du paquet, doublures
  qui lèvent) sont dans [docs/architecture/tests.md](docs/architecture/tests.md#suite-php--dans-le-package-via-orchestra-testbench) : les
  ignorer coûte une demi-journée.
- **Le front est en français en dur**, sans `$t()`. Introduire l'i18n est un chantier à part entière.
- Plusieurs zones sont mortes ou vides (`admin.php` commenté, `console.php` vide, deux mappings
  PSR-4 vers des dossiers inexistants) —
  [liste](docs/architecture/package.md#zones-mortes-connues).
