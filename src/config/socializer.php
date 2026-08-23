<?php

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

        'post' => Dauvray\Socializer\app\Models\Post::class,

        'message' => Dauvray\Socializer\app\Models\Message::class,

        'page' => Dauvray\Socializer\app\Models\Page::class,

        'alert' => Dauvray\Socializer\app\Models\Alert::class,

        'application' => Dauvray\Socializer\app\Models\Application::class,
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
            'feed' => '/feed'
        ]
    ],

    /*
    |--------------------------------------------------------------------------
    | Socializer  Forms
    |--------------------------------------------------------------------------
    */

    'posts' => [
        'classic_form' => (int)env('SOCIALIZER_POST_FORM_ID'), // post form
    ],
    'system_forms' => [
        'create_server_room' => (int)env('SOCIALIZER_CREATE_ROOM_FORM_ID'), //new server room
        'create_server' => (int)env('SOCIALIZER_CREATE_SERVER_FORM_ID'), // server form params
        'create_server_room_module' => (int)env('SOCIALIZER_ADD_ROOM_MODULE_ID'), // new server room module
        'ai_application_details' => (int)env('SOCIALIZER_APP_AI_DETAILS'), // ai application details
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
                ]
            ],
            'group' => [
                'name' => 'group',
                'props' => [
                    'name string NOT NULL',
                    'identifier string NULL',
                ]
            ],
            'comment' => [
                'name' => 'comment',
                'props' => [
                    'content string NULL', 
                ]
            ],
            'post' => [
                'name' => 'post',
                'props' => [
                    'mongoid string NULL',
                    'identifier string NULL',
                ]
            ],
            'share' => [
                'name' => 'share',
                'props' => []
            ],
            'article' => [
                'name' => 'article',
                'props' => [
                    'identifier string NULL',
                ]
            ],
            'feed' => [
                'name' => 'feed',
                'props' => []
            ],
            'wall' => [
                'name' => 'wall',
                'props' => [
                    'questionnaire_id int NULL',
                    'content_type string NULL',
                ]
            ],
            'message' => [
                'name' => 'message',
                'props' => [
                    'mongoid string NULL',
                    'identifier string NULL',
                ]
            ],
            'server' => [
                'name' => 'server',
                'props' => [
                    'name string NULL',
                    'image string NULL',
                    'privacy int NULL',
                    'description string NULL',
                ]
            ],
            'room' => [
                'name' => 'room',
                'props' => [
                    'name string NULL',
                    'image string NULL',
                    'privacy int NULL',
                    'position int NULL',
                    'module_id int NULL',
                ]
            ],
            'data' => [
                'name' => 'data',
                'props' => [
                    'name string NULL',
                    'image string NULL',
                    'content_type string NULL',
                    'questionnaire_id int NULL',
                    'position int NULL',
                ]
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
                ]
            ],
            'whiteboard' => [
                'name' => 'whiteboard',
                'props' => [
                    'name string NULL',
                    'content_type string NULL',
                    'position int NULL',
                    'save_board int NULL',
                ]
            ],
            'classroom' => [
                'name' => 'classroom',
                'props' => [
                    'name string NULL',
                    'content_type string NULL',
                    'position int NULL',
                ]
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
                ]
            ],
            'marketplace' => [
                'name' => 'marketplace',
                'props' => []
            ],
            'application' => [
                'name' => 'application',
                'props' => [
                    'name string NULL',
                    'content_type string NULL',
                    'position int NULL',
                    'image string NULL',
                    'description string NULL',
                ]
            ],
        ],
        'vertices' => [
            'user' => [
                "name" => null,
                "image" => null,
                "cover" => null,
                "active" => null,
                "connected" => null,
                "function" => null,
                "identifier" => null,
                "slug" => null,
                "is_bot" => 0,
            ],
            'group' => [
                "name" => null,
                "identifier" => null,
            ],
            'comment' => [
                'content' => null,
            ],
            'post' => [
                'mongoid' => null,
                "identifier" => null,
            ],
            'share' => [],
            'article' => [
                "identifier" => null,
            ],
            'feed' => [],
            'wall' => [
                "questionnaire_id" => null,
                "content_type" => 'wall',
            ],
            'message' => [
                'mongoid' => null,
                "identifier" => null,
            ],
            'server' => [
                "name" => null,
                "image" => null,
                "privacy" => null,
                "description" => null,
            ],
            'room' => [
                "name" => null,
                "image" => null,
                "privacy" => null,
                "position" => null,
                "module_id" => null,
            ],
            'chat' => [
                "name" => null,
                "image" => null,
                "content_type" => 'chat',
                "privacy" => null,
                "position" => null,
                "is_bot" => null,
                "bot_id" => null,
            ],
            'data' => [
                "name" => null,
                "image" => null,
                "content_type" => 'data',
                "questionnaire_id" => null,
                "position" => null,
            ],
            'whiteboard' => [
                "name" => null,
                "content_type" => 'whiteboard',
                "position" => null,
                "save_board" => null,
            ],
            'classroom' => [
                "name" => null,
                "content_type" => 'classroom',
                "position" => null,
            ],
            'page' => [
                "name" => null,
                "page_id" => null,
                "content_type" => 'page',
                "position" => null,
                "image" => null,
                "description" => null,
            ],
            'marketplace' => [],
            'application' => [
                "name" => null,
                "content_type" => 'application',
                "position" => null,
                "image" => null,
                "description" => null,
            ],
        ],
        'edges' => [
            'has_creator' => [
                'name' => 'has_creator',
                'props' => []
            ],
            'published_in' => [  // principal
                'name' => 'published_in',
                'props' => []
            ],
            'sub_published_in' => [ // secondaire
                'name' => 'sub_published_in',
                'props' => []
            ],
            'reply_of' => [ // comments ...
                'name' => 'reply_of',
                'props' => []
            ],
            'liked_by' => [ // likes ...
                'name' => 'liked_by',
                'props' => []
            ],
            'disliked_by' => [ // likes ...
                'name' => 'disliked_by',
                'props' => []
            ],
            'followed_by' => [ 
                'name' => 'followed_by',
                'props' => []
            ],
            'owned_by' => [ 
                'name' => 'owned_by',
                'props' => []
            ],
            'shared_by' => [ 
                'name' => 'shared_by',
                'props' => []
            ],
            'shared_in' => [ 
                'name' => 'shared_in',
                'props' => []
            ],
            'sharing_of' => [ 
                'name' => 'sharing_of',
                'props' => []
            ],
            'registered_in' => [ 
                'name' => 'registered_in',
                'props' => []
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
        ]
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
        | ⚠️ NIVEAU 1 : les identifiants restent STATIQUES, longue durée et partagés. Ce qui
        | change est le seul fait qu'il faut désormais une session authentifiée pour les
        | obtenir. Le niveau 2 (coturn en `use-auth-secret` + credential HMAC horodaté, lot D
        | de `work/webrtc2-securite-2026-08-14.md`) remplacera `username`/`password` par un
        | secret, sans toucher ni à la route ni à la forme de la réponse.
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
                 * ⚠️ `COTURN_USER` / `COTURN_PASS`, et surtout PAS de nouvelles clés : ce sont
                 * exactement celles que le `docker-compose` passe au conteneur
                 * (`--user ${COTURN_USER}:${COTURN_PASS}`). Deux couples de variables pour un
                 * seul compte, c'est la panne muette garantie le jour où l'on tourne le mot de
                 * passe d'un seul côté.
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
    ],
];
