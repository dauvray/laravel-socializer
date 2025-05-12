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
        | Store FrontController
        |--------------------------------------------------------------------------
        |
        |
        */

        'store' => $prefix_front.'\StoreController',
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
                    'active int NOT NULL',
                    'connected int NULL',
                    'function string NULL',
                    'identifier string NULL',
                    'slug string NULL',
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
                    'author_only int NULL',
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
                "active" => null,
                "connected" => null,
                "function" => null,
                "identifier" => null,
                "slug" => null,
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
            ],
            'message' => [
                'mongoid' => null,
                "identifier" => null,
            ],
            'server' => [
                "name" => null,
                "image" => null,
                "privacy" => null,
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
            ],
            'data' => [
                "name" => null,
                "image" => null,
                "content_type" => 'data',
                "questionnaire_id" => null,
                "position" => null,
                "author_only" => null,
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
    ]
];
