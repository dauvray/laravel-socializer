@php
/** @var \Laravel\Boost\Install\GuidelineAssist $assist */
@endphp
# dauvray/laravel-socializer

Réseau social + temps réel (murs, chat, visio/diffusion WebRTC, tableau blanc, applications IA).
Le paquet **porte sa propre documentation** : lire `vendor/dauvray/laravel-socializer/CLAUDE.md`,
puis suivre sa table de routage vers `docs/INDEX.md`. Ne pas explorer le code au grep avant ça.

- **`components/WebRTC/` (sans le 2) est mort.** L'implémentation vivante est `components/WebRTC2/`.
  Les deux coexistent dans l'arbre avec des fichiers homonymes (`MediaBroadcastProvider.vue`) : un
  symbole trouvé au grep peut venir de la v1.
- **Imports front toujours via l'alias `~socializer`**, jamais en relatif profond. L'alias est défini
  côté hôte dans `vite.config.js` **et** `vitest.config.js` ; un relatif casserait l'un des deux.

@scoped(['vendor/dauvray/laravel-socializer/**'])
# Travailler dans le paquet socializer

- **Les tests JS se lancent depuis la racine du projet hôte** (`npm run test:run`), jamais depuis le
  paquet : il n'a ni `package.json` ni `node_modules`. La contrainte porte sur le répertoire — c'est
  là que vivent `vitest.config.js` et l'alias `~socializer`.
- **Les tests PHP tournent depuis le paquet** (Orchestra Testbench, aucun serveur requis) :
  `composer install && vendor/bin/phpunit` dans `vendor/dauvray/laravel-socializer`.
- **Namespaces PHP en casse mixte, assumée** : `Dauvray\Socializer\app\Models\Post`,
  `Dauvray\Socializer\app\console\Commands\…`. Non-idiomatique mais systématique — le reproduire.
  Le dossier est `src/app/console/` (minuscule) alors que le namespace est `…\app\Console\…` :
  créer une classe autochargée y demande un `composer dump-autoload`.
- **Le front est en français en dur**, sans `$t()`. Introduire l'i18n est un chantier à part entière.
- **Tout sommet NebulaGraph créé sans `id` explicite est dupliqué à chaque passage**
  (`insertVertex` retombe sur `uniqidReal()`). La projection de la base a un seul propriétaire,
  `Services\GraphProjection`, et un invariant : un utilisateur = un mur + un feed —
  `docs/architecture/projection-graphe.md`.
- **Le SCSS du paquet est copié dans l'hôte, et c'est la copie qui est compilée** : retoucher
  `src/resources/sass/` seul ne change rien à l'écran. Modifier les deux — `docs/architecture/conventions.md#scss`.
- Contribution documentaire : **`docs/` = définitif, `work/` = chantier**. Une case à cocher ou un
  décompte de tests ⇒ le fichier appartient à `work/`. Détail dans `docs/ecrire-la-doc.md`.
- Installation / mise à jour dans une app hôte : `{{ $assist->artisanCommand('socializer:build') }}`.
@endscoped
