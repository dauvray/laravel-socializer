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
- **L'identité d'un pair entrant WebRTC2 est corroborée par une attestation signée par le serveur,
  et son REFUS est un réglage — `SOCIALIZER_PEER_ATTESTATION_ENFORCE`, faux par défaut.** Le secret
  dérive d'`APP_KEY` sans variable neuve. Ne l'activer qu'une fois `uncorroboratedAdmissions` (store
  `peers2`) stable à zéro : un refus entrant n'est jamais rattrapable, et un onglet resté sur un
  bundle antérieur n'atteste rien — `docs/modules/webrtc2/securite.md`.
- **Les whispers Reverb ne sont attribuables que sous `accept_client_events_from: 'members'`, et une
  clé ABSENTE de `config/reverb.php` vaut `'all'`** (`ConfigApplicationProvider` lit `?? 'all'`, à
  l'inverse du défaut du paquet Reverb). Sous `'all'`, aucun contrôle d'appartenance au canal et
  `user_id` forgeable : l'annonce de diffusion de WebRTC2 se refuse alors, en le journalisant une
  fois — `docs/modules/webrtc2/securite.md`.

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
- **Ce paquet n'est pas géré par Pint : ne pas lui appliquer celui de l'hôte.** Son style s'est
  écarté du preset Laravel — mesuré, un fichier de 20 lignes modifiées en ressort avec 166 lignes
  réécrites. Relire à l'œil, dans le style du voisinage —
  `docs/architecture/conventions.md#php`.
- **Le front est en français en dur**, sans `$t()`. Introduire l'i18n est un chantier à part entière.
- **Tout sommet NebulaGraph créé sans `id` explicite est dupliqué à chaque passage**
  (`insertVertex` retombe sur `uniqidReal()`). La projection de la base a un seul propriétaire,
  `Services\GraphProjection`, et un invariant : un utilisateur = un mur + un feed —
  `docs/architecture/projection-graphe.md`.
- **Le SCSS du paquet est copié dans l'hôte, et c'est la copie qui est compilée** : retoucher
  `src/resources/sass/` seul ne change rien à l'écran. Modifier les deux — `docs/architecture/conventions.md#scss`.
- **`config('socializer.signaling.ice.turn')` porte le secret de signature HMAC de TOUS les
  utilisateurs.** Ne jamais rendre ce bloc tel quel à un client : `WebRTCController::turnServer()`
  nomme trois clés une par une, liste blanche et jamais liste noire.
- **WebRTC2 : tout chemin qui ouvre une connexion porte un garde d'autorisation, dans les DEUX
  sens** — `utils/isAuthorizedPeer.js` en sortie, `_isAuthorizedIncomingPeer` en entrée. Corollaire
  souvent manqué : **tout chemin qui écrit dans l'allowlist `authorizedCallPeers` en porte un
  aussi**, avant l'écriture — `docs/modules/webrtc2/securite.md`.
- **`Socializable::mayReach()` a un jumeau EN LOT, `reachableVertexIds()`** — même règle et mêmes
  sources, l'un pour un candidat, l'autre pour une liste (`Users::visibleUsers`). Les faire diverger
  rouvre l'énumération ou masque des contacts légitimes : `UserListScopeTest` compare les deux.
- Contribution documentaire : **`docs/` = définitif, `work/` = chantier**. Une case à cocher ou un
  décompte de tests ⇒ le fichier appartient à `work/`. Détail dans `docs/ecrire-la-doc.md`.
- Installation / mise à jour dans une app hôte : `{{ $assist->artisanCommand('socializer:build') }}`.
@endscoped

@scoped(['vendor/dauvray/laravel-socializer/src/resources/js/socializer/components/Server/**'])
# Navigation serveur → salon → contenu

- **Ne jamais `router.push()` depuis une garde de navigation : ça ANNULE la navigation en vol**, et
  `RouterLink` avale l'échec — le clic ne fait rien, sans erreur ni log. Retourner la cible.
- **Dans une garde, `currentRoom` porte encore l'ANCIEN salon.** Il ne bascule qu'au `initRoom()` du
  composant remonté par le `:key="$route.params.roomId"` du `<router-view>` de `Server.vue` — clé
  porteuse, pas décorative.
- **Le fil d'Ariane s'écrit depuis un `watch(route)`, jamais depuis une garde** : l'`App.vue` du
  projet hôte reconstruit tout le tableau depuis `route.meta.breadcrumb` après chaque navigation.
- Le détail et la non-régression : `docs/modules/serveurs-et-salons.md` et
  `components/Server/__tests__/roomNavigation.test.js`.
@endscoped
