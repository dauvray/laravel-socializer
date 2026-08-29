<?php

use Dauvray\Socializer\app\Models\Alert;
use Dauvray\Socializer\app\Models\Application;
use Dauvray\Socializer\app\Models\Message;
use Dauvray\Socializer\app\Models\Page;
use Dauvray\Socializer\app\Models\Post;

$prefix_back = '\Dauvray\Socializer\app\Http\Controllers\Admin';
$prefix_front = '\Dauvray\Socializer\app\Http\Controllers\Front';

return [

    /*
    |--------------------------------------------------------------------------
    | Socializer Controllers
    |--------------------------------------------------------------------------
    */

    'prefix_back' => $prefix_back,

    'prefix_front' => $prefix_front,

    'controllers_back' => [

    ],

    'controllers_front' => [

        /*
        |--------------------------------------------------------------------------
        | Comment FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'comment' => $prefix_front.'\CommentController',

        /*
        |--------------------------------------------------------------------------
        | Like FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'like' => $prefix_front.'\LikeController',

        /*
        |--------------------------------------------------------------------------
        | Wall FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'wall' => $prefix_front.'\WallController',

        /*
        |--------------------------------------------------------------------------
        | User FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'user' => $prefix_front.'\UserController',

        /*
        |--------------------------------------------------------------------------
        | Feed FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'feed' => $prefix_front.'\FeedController',

        /*
        |--------------------------------------------------------------------------
        | Chat FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'chat' => $prefix_front.'\ChatController',

        /*
        |--------------------------------------------------------------------------
        | Server FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'server' => $prefix_front.'\ServerController',

        /*
        |--------------------------------------------------------------------------
        | Page FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'page' => $prefix_front.'\PageController',

        /*
        |--------------------------------------------------------------------------
        | WhiteBoard FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'whiteboard' => $prefix_front.'\WhiteBoardController',

        /*
        |--------------------------------------------------------------------------
        | ApplicationIA FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'application_ia' => $prefix_front.'\ApplicationIAController',

        /*
        |--------------------------------------------------------------------------
        | QuestionnaireIA FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'questionnaire_ia' => $prefix_front.'\QuestionnaireIAController',

        /*
        |--------------------------------------------------------------------------
        | Store FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'store' => $prefix_front.'\StoreController',

        /*
        |--------------------------------------------------------------------------
        | WebRTC FrontController
        |--------------------------------------------------------------------------
        |
        | Sert la configuration ICE (`signaling.ice` plus bas) au navigateur.
        |
        */

        'webrtc' => $prefix_front.'\WebRTCController',
    ],

    /*
    |--------------------------------------------------------------------------
    | Socializer Models
    |--------------------------------------------------------------------------
    */

    'models' => [

        'post' => Post::class,

        'message' => Message::class,

        'page' => Page::class,

        'alert' => Alert::class,

        'application' => Application::class,
    ],

    /*
    |--------------------------------------------------------------------------
    | Socializer Tables
    |--------------------------------------------------------------------------
    */

    'table_names' => [

    ],

    /*
    |--------------------------------------------------------------------------
    | Socializer Front Routes
    |--------------------------------------------------------------------------
    */

    'routes' => [
        'front' => [
            'profile' => '/mon-profil',
            'networks' => '/networks',
            'feed' => '/feed',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Socializer  Forms
    |--------------------------------------------------------------------------
    */

    'posts' => [
        'classic_form' => (int) env('SOCIALIZER_POST_FORM_ID'), // post form
    ],
    'system_forms' => [
        'create_server_room' => (int) env('SOCIALIZER_CREATE_ROOM_FORM_ID'), // new server room
        'create_server' => (int) env('SOCIALIZER_CREATE_SERVER_FORM_ID'), // server form params
        'create_server_room_module' => (int) env('SOCIALIZER_ADD_ROOM_MODULE_ID'), // new server room module
        'ai_application_details' => (int) env('SOCIALIZER_APP_AI_DETAILS'), // ai application details
    ],

    /*
    |--------------------------------------------------------------------------
    | Nebulagraph items
    |--------------------------------------------------------------------------
    */

    // created_at is automaticaly added with elements
    // don't define this prop
    'nebulagraph' => [
        'sleeping_duration' => 20,
        'tags' => [
            'user' => [
                'name' => 'user',
                'props' => [
                    'name string NOT NULL',
                    'image string NULL',
                    'cover string NULL',
                    'active int NOT NULL',
                    'connected int NULL',
                    'function string NULL',
                    'identifier string NULL',
                    'slug string NULL',
                    'is_bot int NULL',
                ],
            ],
            'group' => [
                'name' => 'group',
                'props' => [
                    'name string NOT NULL',
                    'identifier string NULL',
                ],
            ],
            'comment' => [
                'name' => 'comment',
                'props' => [
                    'content string NULL',
                ],
            ],
            'post' => [
                'name' => 'post',
                'props' => [
                    'mongoid string NULL',
                    'identifier string NULL',
                ],
            ],
            'share' => [
                'name' => 'share',
                'props' => [],
            ],
            'article' => [
                'name' => 'article',
                'props' => [
                    'identifier string NULL',
                ],
            ],
            'feed' => [
                'name' => 'feed',
                'props' => [],
            ],
            'wall' => [
                'name' => 'wall',
                'props' => [
                    'questionnaire_id int NULL',
                    'content_type string NULL',
                ],
            ],
            'message' => [
                'name' => 'message',
                'props' => [
                    'mongoid string NULL',
                    'identifier string NULL',
                ],
            ],
            'server' => [
                'name' => 'server',
                'props' => [
                    'name string NULL',
                    'image string NULL',
                    'privacy int NULL',
                    'description string NULL',
                ],
            ],
            'room' => [
                'name' => 'room',
                'props' => [
                    'name string NULL',
                    'image string NULL',
                    'privacy int NULL',
                    'position int NULL',
                    'module_id int NULL',
                ],
            ],
            'data' => [
                'name' => 'data',
                'props' => [
                    'name string NULL',
                    'image string NULL',
                    'content_type string NULL',
                    'questionnaire_id int NULL',
                    'position int NULL',
                ],
            ],
            'chat' => [
                'name' => 'chat',
                'props' => [
                    'name string NULL',
                    'image string NULL',
                    'privacy int NULL',
                    'content_type string NULL',
                    'position int NULL',
                    'is_bot int NULL',
                    'bot_id int NULL',
                ],
            ],
            'whiteboard' => [
                'name' => 'whiteboard',
                'props' => [
                    'name string NULL',
                    'content_type string NULL',
                    'position int NULL',
                    'save_board int NULL',
                ],
            ],
            'classroom' => [
                'name' => 'classroom',
                'props' => [
                    'name string NULL',
                    'content_type string NULL',
                    'position int NULL',
                ],
            ],
            'page' => [
                'name' => 'page',
                'props' => [
                    'name string NULL',
                    'content_type string NULL',
                    'page_id string NULL',
                    'position int NULL',
                    'image string NULL',
                    'description string NULL',
                ],
            ],
            'marketplace' => [
                'name' => 'marketplace',
                'props' => [],
            ],
            'application' => [
                'name' => 'application',
                'props' => [
                    'name string NULL',
                    'content_type string NULL',
                    'position int NULL',
                    'image string NULL',
                    'description string NULL',
                ],
            ],
        ],
        'vertices' => [
            'user' => [
                'name' => null,
                'image' => null,
                'cover' => null,
                'active' => null,
                'connected' => null,
                'function' => null,
                'identifier' => null,
                'slug' => null,
                'is_bot' => 0,
            ],
            'group' => [
                'name' => null,
                'identifier' => null,
            ],
            'comment' => [
                'content' => null,
            ],
            'post' => [
                'mongoid' => null,
                'identifier' => null,
            ],
            'share' => [],
            'article' => [
                'identifier' => null,
            ],
            'feed' => [],
            'wall' => [
                'questionnaire_id' => null,
                'content_type' => 'wall',
            ],
            'message' => [
                'mongoid' => null,
                'identifier' => null,
            ],
            'server' => [
                'name' => null,
                'image' => null,
                'privacy' => null,
                'description' => null,
            ],
            'room' => [
                'name' => null,
                'image' => null,
                'privacy' => null,
                'position' => null,
                'module_id' => null,
            ],
            'chat' => [
                'name' => null,
                'image' => null,
                'content_type' => 'chat',
                'privacy' => null,
                'position' => null,
                'is_bot' => null,
                'bot_id' => null,
            ],
            'data' => [
                'name' => null,
                'image' => null,
                'content_type' => 'data',
                'questionnaire_id' => null,
                'position' => null,
            ],
            'whiteboard' => [
                'name' => null,
                'content_type' => 'whiteboard',
                'position' => null,
                'save_board' => null,
            ],
            'classroom' => [
                'name' => null,
                'content_type' => 'classroom',
                'position' => null,
            ],
            'page' => [
                'name' => null,
                'page_id' => null,
                'content_type' => 'page',
                'position' => null,
                'image' => null,
                'description' => null,
            ],
            'marketplace' => [],
            'application' => [
                'name' => null,
                'content_type' => 'application',
                'position' => null,
                'image' => null,
                'description' => null,
            ],
        ],
        'edges' => [
            'has_creator' => [
                'name' => 'has_creator',
                'props' => [],
            ],
            'published_in' => [  // principal
                'name' => 'published_in',
                'props' => [],
            ],
            'sub_published_in' => [ // secondaire
                'name' => 'sub_published_in',
                'props' => [],
            ],
            'reply_of' => [ // comments ...
                'name' => 'reply_of',
                'props' => [],
            ],
            'liked_by' => [ // likes ...
                'name' => 'liked_by',
                'props' => [],
            ],
            'disliked_by' => [ // likes ...
                'name' => 'disliked_by',
                'props' => [],
            ],
            'followed_by' => [
                'name' => 'followed_by',
                'props' => [],
            ],
            'owned_by' => [
                'name' => 'owned_by',
                'props' => [],
            ],
            'shared_by' => [
                'name' => 'shared_by',
                'props' => [],
            ],
            'shared_in' => [
                'name' => 'shared_in',
                'props' => [],
            ],
            'sharing_of' => [
                'name' => 'sharing_of',
                'props' => [],
            ],
            'registered_in' => [
                'name' => 'registered_in',
                'props' => [],
            ],
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Agents ia
    |--------------------------------------------------------------------------
    */

    'agents_ai' => [
        'openai' => [
            'key' => env('SOCIALIZER_OPENAI_KEY', ''),
            'model' => env('SOCIALIZER_OPENAI_MODEL', 'gpt-3.5-turbo'),
            'url' => env('SOCIALIZER_OPENAI_URL', ''),
        ],
        'anthropic' => [
            'key' => env('SOCIALIZER_ANTHROPIC_KEY', ''),
            'model' => env('SOCIALIZER_ANTHROPIC_MODEL', 'claude-2'),
            'url' => env('SOCIALIZER_ANTHROPIC_URL', ''),
        ],
        'chatbot' => [
            'user_id' => env('SOCIALIZER_CHATBOT_USER_ID', null),
        ],
        'n8n' => [
            'create_questionnaire_webhook' => env('SOCIALIZER_N8N_CREATE_QUESTIONNAIRE_WEBHOOK', null),
        ],
        // todo a transformer en webhook n8n plus tard
        // ou autre systeme de gestion de tache asynchrone
        // ou gestion directe dans le front en js
        // pour l'instant on garde comme ca
        'copywriter' => [
            'user_id' => env('SOCIALIZER_COPYWRITER_USER_ID', null),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Signalisation WebRTC
    |--------------------------------------------------------------------------
    |
    | Plafonds serveur des routes de signalisation. Le limiteur de `usePeerCore` est un
    | anti-spam *involontaire* : il vit dans le bundle, un attaquant le retire en une ligne.
    | Ces valeurs sont la seule borne réelle — chaque requête relayée déclenche un
    | `Broadcast::private(...)->sendNow()` vers la victime.
    |
    | Les limiteurs eux-mêmes sont déclarés dans `ServiceProvider::registerSignalingRateLimiters()`
    | et posés sur les routes dans `routes/socializer/routes.private.php`.
    |
    */

    'signaling' => [

        'throttle' => [

            /*
             * Bucket `socializer-signaling` — /ask-to-peer-id, /response-to-peer-id,
             * /close-connection-to-peer-id. Par utilisateur émetteur.
             *
             * ⚠️ Dimensionner AU-DESSUS de la rafale de join : une room mesh émet
             * légitimement 14 demandes dans le MÊME tick (7 pairs × type principal + écran,
             * cf. MAX_PEERS_PER_ROOM dans webrtc2.config.js). 120/min laisse 8,5× cette
             * rafale et couvre le hopping de rooms (3 rooms/min ≈ 84 requêtes).
             *
             * Ce qu'il écrête volontairement : la boucle de recovery dégénérée
             * (`peer-unavailable` sur 14 clés × 3 par 10 s ≈ 250/min). C'est l'effet
             * recherché — c'est déjà la raison d'être du limiteur client. Un 429 sur
             * /ask-to-peer-id est rattrapé par la re-demande de SIGNALING_STALE_MS.
             */
            'mesh_per_minute' => (int) env('SOCIALIZER_SIGNALING_THROTTLE_PER_MINUTE', 120),

            /*
             * Bucket `socializer-call-invite` — /send-alert-to-user,
             * /response-to-authorization-peer. DEUX limites composées.
             *
             * Par couple (émetteur, cible) : une invitation complète coûte ~9 requêtes en
             * 55 s (1 envoi immédiat + le backoff 1-2-4-8-10-10-10 s de usePeerRetry). 20
             * laisse la marge d'une annulation suivie d'un rappel.
             */
            'invite_per_target_per_minute' => (int) env('SOCIALIZER_CALL_INVITE_THROTTLE_PER_TARGET', 20),

            /*
             * Par émetteur, toutes cibles confondues : sans elle, la limite par cible se
             * contourne en arrosant N victimes d'une invitation chacune.
             */
            'invite_per_minute' => (int) env('SOCIALIZER_CALL_INVITE_THROTTLE_PER_MINUTE', 40),
        ],

        /*
        |--------------------------------------------------------------------------
        | Garde de relation (C2)
        |--------------------------------------------------------------------------
        |
        | `Socializable::mayReach()` refuse de signaler un utilisateur avec qui on n'a
        | ni groupe commun ni follow réciproque. Posé sur les 5 routes ci-dessus.
        |
        */

        'relation' => [

            /*
             * Durée de mémorisation du verdict, en secondes. La rafale de join émet 14
             * requêtes dans le même tick : sans cache, c'est 14 fois le prédicat.
             *
             * Le follow est invalidé explicitement (`Users::followUser`/`unfollowUser`),
             * donc un refus périmé ne survit pas à un nouveau follow. Les changements de
             * groupe, eux, sont pilotés par Backpack hors du paquet : ce TTL est la seule
             * borne de leur péremption.
             */
            'cache_ttl' => (int) env('SOCIALIZER_RELATION_CACHE_TTL', 60),

            /*
             * Pivot user ↔ group de `innovation/laravel-estarter`. Son nom est en dur dans
             * `Dauvray\Estarter\...\GroupUser::$table` — non configurable en amont, d'où
             * cette clé. Lu par requête directe et non via `EstarterUser::groups()` : cette
             * relation vit dans un paquet que le harnais de tests double par un stub.
             */
            'group_user_table' => env('SOCIALIZER_RELATION_GROUP_USER_TABLE', 'group_user'),
        ],

        /*
        |--------------------------------------------------------------------------
        | Serveurs ICE (STUN / TURN)
        |--------------------------------------------------------------------------
        |
        | Ce que le navigateur reçoit dans `config.iceServers` de `new Peer(...)`. Servi par
        | `/get-ice-servers`, et NON PLUS compilé dans le bundle : `VITE_COTURN_USERNAME` /
        | `VITE_COTURN_CREDENTIAL` étaient inlinés par Vite au build, donc lisibles par
        | quiconque ouvrait le JS — relais TURN ouvert, bande passante imputable au serveur.
        |
        | Effet de bord voulu : une clé `VITE_*` n'a d'effet qu'après un `npm run build`, une
        | clé lue par PHP prend effet au redémarrage. Changer de TURN redevient une édition
        | de `.env`.
        |
        | DEUX MODES D'AUTHENTIFICATION, et c'est la PRÉSENCE de `turn.static_auth_secret` qui
        | commute, jamais une clé de mode :
        |
        |  - secret posé ⇒ TURN REST API. coturn tourne en `--use-auth-secret
        |    --static-auth-secret <même valeur>`, le contrôleur signe un couple horodaté par
        |    utilisateur. C'est le mode recommandé, et le seul où un abus soit attribuable.
        |  - secret vide ⇒ le couple statique `username`/`password`, longue durée et partagé
        |    entre tous les utilisateurs. Conservé pour ne pas casser un déploiement dont le
        |    coturn est encore en `--user` : un refus sec serait une panne muette offerte à
        |    toute installation existante.
        |
        */

        'ice' => [

            /*
             * STUN — servi à TOUT LE MONDE, invité compris : il ne porte aucun identifiant, et
             * sans lui un pair derrière NAT n'obtient même pas de candidat `srflx`.
             *
             * Liste séparée par des virgules, pour que la variable `.env` reste scalaire comme
             * partout ailleurs dans ce fichier. Le défaut est EXACTEMENT ce qui était en dur
             * dans le bundle : déplacer le secret ne doit rien changer au chemin ICE.
             *
             * ⚠️ Un réseau fermé sans sortie Internet doit la vider (`SOCIALIZER_STUN_URLS=`) :
             * un STUN injoignable ne casse pas la négociation, il l'allonge de son timeout.
             */
            'stun_urls' => array_values(array_filter(array_map('trim', explode(
                ',',
                (string) env('SOCIALIZER_STUN_URLS', 'stun:stun.l.google.com:19302')
            )))),

            'turn' => [

                /*
                 * Hôte du relais coturn, SANS schéma ni port. UNE seule variable nouvelle, et
                 * elle est facultative : à défaut on dérive l'hôte d'`APP_URL`, ce que le
                 * bundle faisait déjà par un autre chemin (`turn:${VITE_PEERS_SERVER_HOST}`).
                 * Ne PAS relire `VITE_PEERS_SERVER_HOST` ici : les `VITE_*` décrivent ce qui
                 * part dans le bundle, et c'est précisément ce dont on sort ; cette
                 * variable-là reste, mais pour le serveur PeerJS seul.
                 *
                 * La renseigner dès que coturn cesse de répondre sur le nom de l'application.
                 *
                 * Le `?: null` final n'est pas décoratif : `parse_url()` rend `false` sur une
                 * URL malformée, et `'turn:'.false.':3478'` donnerait `turn::3478` — une URL
                 * d'apparence valide que l'agent ICE tenterait.
                 */
                'host' => env('SOCIALIZER_TURN_HOST')
                    ?: (parse_url((string) env('APP_URL'), PHP_URL_HOST) ?: null),

                /*
                 * Port d'écoute. 3478 est celui que le `docker-compose` publie en TCP ET UDP ;
                 * pas de 5349, le conteneur tourne en `--no-tls --no-dtls`.
                 */
                'port' => (int) env('SOCIALIZER_TURN_PORT', 3478),

                /*
                 * ⚠️ UNE SEULE VARIABLE, LUE DES DEUX CÔTÉS. C'est la même règle qui imposait
                 * `COTURN_USER` / `COTURN_PASS` ci-dessous plutôt que des clés neuves : le
                 * `docker-compose` de l'hôte interpole `COTURN_STATIC_AUTH_SECRET` dans
                 * `--static-auth-secret`, PHP lit la même clé. Deux variables pour un seul
                 * secret, c'est la panne muette garantie le jour où l'on n'en tourne qu'une —
                 * et ici la panne serait silencieuse des deux côtés : coturn refuserait chaque
                 * allocation, le navigateur se rabattrait sur STUN, et le symptôme serait
                 * « la visio ne passe que sur le réseau local ».
                 *
                 * ⚠️ CE SECRET EST CELUI DE TOUS LES UTILISATEURS. Le publier ne vaut pas
                 * seulement un relais ouvert : il permet de forger le credential de n'importe
                 * qui, donc de perdre la non-répudiation que ce mode achète. Il ne sort JAMAIS
                 * d'ici — le contrôleur nomme trois clés une par une, et
                 * `IceServersTest::la_charge_utile_ne_relaie_que_les_trois_cles_attendues` est
                 * ce qui arrête un splat écrit distraitement.
                 *
                 * Vide = mode statique (voir la bannière de section). Le générer :
                 * `openssl rand -hex 32`.
                 */
                'static_auth_secret' => env('COTURN_STATIC_AUTH_SECRET'),

                /*
                 * Durée de vie du credential signé, en secondes. Elle est ANNONCÉE au client, sous
                 * la clé `credential_ttl` à la racine de la réponse de `/get-ice-servers` : c'est
                 * ce qui lui permet de programmer son rafraîchissement (`_scheduleIceRefresh` dans
                 * `usePeerTransport`). Une DURÉE et non une échéance, pour ne dépendre d'aucune
                 * horloge partagée.
                 *
                 * 24 h par défaut, et ce n'est plus une contrainte technique mais un choix
                 * conservateur : depuis que le client rafraîchit, un onglet resté ouvert ne perd
                 * plus son relais. Ce que ce mode achète n'est pas la brièveté mais le fait que le
                 * credential soit par-utilisateur — `--user-quota` devient un plafond par personne,
                 * les journaux coturn nomment l'abuseur, et une rotation du secret invalide tout
                 * l'existant d'un coup.
                 *
                 * ⚠️ DEUX RÉSERVES avant de descendre à l'échelle de l'heure. Le rafraîchissement
                 * est BORNÉ (`ICE_REFRESH_MAX_RETRIES`) : sur une route en panne, il abandonne et
                 * l'onglet retombe sur l'ancien comportement — « la visio ne passe plus, un F5 la
                 * répare ». Et `routes.public.php` documente que cette route n'a pas de `throttle`,
                 * avec pour condition de réouverture explicite « un credential court ET
                 * re-demandé » : un TTL horaire rouvre donc cette question. Détail dans
                 * `docs/modules/webrtc2/securite.md`, section « Le rafraîchissement du credential
                 * TURN ».
                 */
                'credential_ttl' => (int) env('COTURN_CREDENTIAL_TTL', 86400),

                /*
                 * ⚠️ MODE STATIQUE — conservé pour les déploiements dont le coturn tourne encore
                 * en `--user ${COTURN_USER}:${COTURN_PASS}`. Ces deux variables sont exactement
                 * celles que ce `docker-compose`-là passe au conteneur, pour la raison écrite
                 * juste au-dessus. Elles sont IGNORÉES dès que `static_auth_secret` est posé.
                 *
                 * Vides = déploiement SANS relais : le contrôleur n'émet alors AUCUNE entrée
                 * TURN. Surtout pas une entrée aux identifiants nuls — l'agent ICE la
                 * traiterait comme un serveur à interroger et attendrait son échec
                 * d'authentification avant de conclure.
                 */
                'username' => env('COTURN_USER'),
                'password' => env('COTURN_PASS'),
            ],
        ],

        /*
        |--------------------------------------------------------------------------
        | Attestation de peerId
        |--------------------------------------------------------------------------
        |
        | Ce qui corrobore l'identité d'un pair entrant sur le chemin (a) de
        | `_isAuthorizedIncomingPeer` — l'appartenance à la room. Ce chemin admettait sur le
        | seul `metadata.from`, un champ que l'émetteur choisit : un membre qui ouvrait un
        | SECOND `new Peer()` obtenait un UUID non mappé et parlait sous l'identité d'un
        | autre membre. Le récepteur ne pouvait pas trancher — le cas nominal de la présence
        | et l'usurpation ont la même signature locale.
        |
        | Le serveur signe donc `{peerId, slug, exp}` à l'ouverture du `Peer`, le client
        | transporte l'attestation dans la `metadata` de chaque connexion sortante, et le
        | récepteur la fait vérifier. Le slug signé vient d'`Auth::user()`, jamais du corps
        | de la requête : c'est ce qui la rend infalsifiable.
        |
        | ⚠️ AUCUNE de ces clés n'est une variable `VITE_*`, et ce n'est pas un oubli. Vite
        | substitue `import.meta.env.VITE_*` AU BUILD, qui a lieu à la construction de
        | l'image : un secret y serait servi en clair à tout visiteur, et un réglage y serait
        | promis comme une édition de `.env` puis livré comme une reconstruction d'image.
        |
        */

        'attestation' => [

            /*
             * Secret de signature HMAC-SHA256. VIDE PAR DÉFAUT, et le contrôleur retombe
             * alors sur une clé DÉRIVÉE d'`APP_KEY` — pas sur `APP_KEY` elle-même, dont la
             * dérivation par domaine évite qu'une signature d'attestation puisse servir
             * ailleurs. Le mécanisme fonctionne donc sans variable de déploiement neuve, et
             * une rotation d'`APP_KEY` le rote.
             *
             * ⚠️ Ce secret ne doit JAMAIS atteindre une réponse HTTP : c'est de quoi forger
             * l'identité de n'importe quel utilisateur. Même doctrine que
             * `ice.turn.static_auth_secret` — liste blanche à la sortie, jamais liste noire.
             */
            'secret' => env('SOCIALIZER_PEER_ATTESTATION_SECRET'),

            /*
             * Durée de vie d'une attestation, en secondes. Elle borne le REJEU : un pair
             * parti laisse son UUID reprenable sur le serveur PeerJS passé `alive_timeout`
             * (60 s), et c'est cette durée-là qui décide combien de temps son attestation
             * resterait exploitable par qui reprendrait son id.
             *
             * 300 s tient entre deux contraintes opposées : au-dessous, le rafraîchissement
             * client devient bavard sur un onglet ouvert toute la journée ; au-dessus, la
             * fenêtre de rejeu s'ouvre pour rien. Sans commune mesure avec le TTL du
             * credential TURN (24 h) : celui-ci authentifie un RELAIS, celui-là une PERSONNE.
             */
            'ttl' => (int) env('SOCIALIZER_PEER_ATTESTATION_TTL', 300),

            /*
             * Le garde d'admission REFUSE-T-IL une admission non corroborée sur le chemin
             * (a) ? Faux par défaut, et c'est une décision de déploiement, pas une frilosité.
             *
             * Un onglet resté sur un bundle antérieur au déploiement n'attesterait rien, et
             * un refus entrant n'est JAMAIS rattrapable (une MediaConnection refusée n'est
             * notifiée à personne, et l'émetteur voit son `peerConnection` en `connecting`,
             * donc son moteur de retry s'arrête). Refuser d'emblée couperait donc la visio
             * en room pendant toute la fenêtre d'un déploiement mixte.
             *
             * La marche à suivre n'est pas « attendre », et elle ne se lit pas à un seul
             * endroit : le `Log::warning('Attestation de pair refusée')` du serveur voit
             * TOUS les utilisateurs mais seulement les attestations PRÉSENTÉES, et les trois
             * compteurs de `Widgets/UI/Report/Debug.vue` voient tout ce qui entre mais dans
             * UN onglet. La procédure exacte, avec ce qui reste une borne assumée — le cas
             * « aucune attestation présentée » n'est mesurable sur aucun serveur :
             * `docs/modules/webrtc2/securite.md`, § « Ce qu'il faut regarder pour basculer ».
             *
             * La valeur est servie au client dans la réponse d'attestation : la politique
             * est celle du SERVEUR, elle ne se compile pas dans le bundle.
             */
            'enforce' => (bool) env('SOCIALIZER_PEER_ATTESTATION_ENFORCE', false),
        ],
    ],
];
