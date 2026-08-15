# laravel-socializer

> **Ce fichier couvre l'installation et la configuration.**
> Architecture, conventions et documentation des modules : [`docs/INDEX.md`](docs/INDEX.md).
> Chantiers en cours : [`work/README.md`](work/README.md).

## Requirements

This package needs Redis

    // php-ext
    pecl install redis

    // server
    sudo dnf install redis
    sudo apt install php-redis
    sudo systemctl enable redis
    sudo systemctl start redis
    sudo systemctl restart php-fpm

## Installation

    composer config repositories.dauvray/laravel-socializer vcs https://github.com/dauvray/laravel-socializer.git
    composer require dauvray/laravel-socializer:dev-master


Add to config/database.php

    'connections' => [
        'nebula' => [
            'driver' => 'nebula',
            'host' => env('DB_HOST_NEBULA', '127.0.0.1'),
            'port' => env('DB_PORT_NEBULA', '9669'),
            'username' => env('DB_USERNAME_NEBULA', 'root'),
            'password' => env('DB_PASSWORD_NEBULA', 'nebula'),
            'space' => env('DB_GRAPH_SPACE', 'infrastructure'),
            'partition' => env('DB_GRAPH_PARTITION', 5),
            'replica_factor' => env('DB_GRAPH_REPLICA_FACTOR', 3),
            'options' => [],
        ],
    ]

Add Commentable trait to model who can be commented e.g : /app/Article.php
And change config/eblogger

    <?php

        namespace App\Models;

        use Dauvray\Eblogger\app\Models\Article as EbloggerArticle;
        use Dauvray\Socializer\app\Helpers\ModelTraits\Commentable;

        class Article extends EbloggerArticle
        {
            use Commentable;
        }


Add SocializerUser trait to /app/user.php

    use Dauvray\Socializer\app\Helpers\ModelTraits\Socializable;
     
     class User extends EstarterUser
     {
         use Socializable;   <-- here
     }

Add overwrite method in /app/User.php

    public function getConnectedAttribute()
    {
        if ($this->is_bot === 0) {
            return parent::getConnectedAttribute();
        }
        return 1;
    }

Overwrites views with comments components on blades

    <div class="eb-comments">
        @include('socializer::widgets.comments')
    </div>

Add SocializerHelperTrait to all needed CRUD  

    use Dauvray\Socializer\app\Helpers\ControllerTraits\SocializerHelperTrait;

    class ArticleCrudController extends CrudController
    {
        use SocializerHelperTrait;

        public function setFields()
        {
            // ... 
            $this->socializerFields();
        }
    }

Add to vite.config.js

    import react from '@vitejs/plugin-react'

    define: {
        'process.env': {}, // pour React
    },
    plugins: [
    ....
        react(),
    ....
    ],
    vue({
    template: {
    ....
        compilerOptions: {
            isCustomElement: (tag) => tag === 'excalidraw-element'
        }
    ....    
    },
}),
     alias: {
    ...
        'react': "react",
        "react-dom": "react-dom",
    ...

     }

Add to bootstrap/app.php ( n8n )

    ->withMiddleware(function (Middleware $middleware) {
        $middleware->validateCsrfTokens(except: [
            '/bot-response-answer',
        ]);
    })


Build the component
     
    php artisan socializer:build
    npm run dev

Register the components — /resources/js/vue.js (Vue 3 + Pinia)

Le package expose des composants Vue 3 via l'alias `~socializer`. Les stores sont des
stores **Pinia** auto-enregistrés par `defineStore` : il n'y a rien à brancher côté store,
il suffit que `createPinia()` soit installé sur l'app.

    import { createApp } from 'vue/dist/vue.esm-bundler'
    import { createPinia } from 'pinia'

    window.estarterApp = createApp()
    window.estarterApp.use(createPinia()).use(router)

    // socializer
    import SeverWidget from '~socializer/components/System/Server.vue'
    import CommentWidget from '~socializer/components/Comment/Comments.vue'

    window.estarterApp
        .component('server-widget', SeverWidget)
        .component('socializer-comments', CommentWidget)

Add somewhere in the template

`System/Notifications.vue` doit être **monté en permanence** : c'est lui qui traduit les
événements Reverb en signaux WebRTC2 et qui porte le contexte `data-app`. Sans lui, aucune
signalisation n'arrive.

    <socializer-notifications style="position:absolute;top:-2000px;"></socializer-notifications>

## Configuration

Add to .env

    MIX_FORMDESIGNER_CREATE_ROOM_ID=__ID__
    MIX_FORMDESIGNER_UPDATE_ROOM_ID=__ID__


Add to resources/js/bootstrap.js

    import './echo.js';

## NGINX & Turn server

1. Créer le fichier turn.conf

    sudo nano /etc/nginx/streams-enabled/turn.conf

Ajoute ceci :

    stream {
        upstream turn_server_tcp {
            server 127.0.0.1:3478;
        }

        server {
            listen 3478;
            proxy_pass turn_server_tcp;
        }
    }

2. Inclure ce fichier dans nginx.conf global
Ouvre /etc/nginx/nginx.conf (ou /usr/local/nginx/conf/nginx.conf selon ta distro).

Dans le bloc de niveau supérieur (pas dans http), ajoute :

    include /etc/nginx/streams-enabled/*.conf;

Cela doit être hors du bloc http {} :


# nginx.conf

worker_processes auto;
events { worker_connections 1024; }

# Inclure les streams TURN ici
include /etc/nginx/streams-enabled/*.conf;

http {
    ...
}

3. Tester et redémarrer Nginx

sudo nginx -t
sudo systemctl reload nginx



                
