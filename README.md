# laravel-socializer

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
     alias: {
    ...
        'react': "react",
        "react-dom": "react-dom",
    ...

     }


Build the component
     
    php artisan socializer:build
    npm run dev

Add to /resources/app.js

    // socializer
    Vue.component('network-widget', require('vuejs-socializer/components/widgets/Network.vue').default);
    Vue.component('wall-widget', require('vuejs-socializer/components/widgets/Wall.vue').default);
    Vue.component('feed-widget', require('vuejs-socializer/components/widgets/Feed.vue').default);
    Vue.component('user-list-widget', require('vuejs-socializer/components/widgets/users/UsersList.vue').default);
    Vue.component('socializer-notifications', require('vuejs-socializer/components/widgets/Notifications.vue').default);

    import modulesSocializer from 'vuejs-socializer/state/modules'

    const store = new Vuex.Store({
        modules: {
            // ...
            ...modulesSocializer,
           // ...
        },
        // ...
    });

Add somewhere in the template 

    <socializer-notifications style="position:absolute;top:-2000px;"></socializer-notifications>

Add navbar to App.vue

    <NavBarWidget id="main-navbar" menuName="Menu Socializer"/>
    import NavBarWidget from '~estarter/components/widgets/NavBar.vue'

## Configuration

Add to .env

    MIX_FORMDESIGNER_CREATE_ROOM_ID=__ID__
    MIX_FORMDESIGNER_UPDATE_ROOM_ID=__ID__




                
