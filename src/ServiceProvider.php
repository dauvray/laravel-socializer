<?php namespace Dauvray\Socializer;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\View;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Blade;
use Dauvray\Socializer\app\Helpers\NebulaGraphConnection;
use Dauvray\Socializer\app\Services\RedisService;
use Dauvray\Socializer\app\Providers\SocializerEventServiceProvider;

class ServiceProvider extends \Illuminate\Support\ServiceProvider
{
    /**
     * Indicates if loading of the provider is deferred.
     *
     * @var bool
     */
    protected $defer = false;

    /**
     * Where the route file lives, both inside the package and in the app (if overwritten).
     *
     * @var string
     */
    public $routeFilePath = '/routes/socializer/routes.php';
    public $routeChannelsFilePath = '/routes/socializer/channels.php';
    public $routeFilePathAdmin = '/routes/socializer/admin.php';
    public $routeApiFilePath = '/routes/socializer/api.php';
    public $routeFilePathConsole = '/routes/socializer/console.php';


    /**
     * Register the service provider.
     *
     * @return void
     */
    public function register()
    {
        $configPath = __DIR__ . '/config/socializer.php';
        $this->mergeConfigFrom($configPath, 'socializer');

        $configPath2 = __DIR__ . '/config/modules.php';
        $this->mergeConfigFrom($configPath2, 'socializer.modules');

        // filesystem
        \Config::set('filesystems.disks.protected', [
            'driver' => 'local',
            'root' => storage_path('app/filemanager'),
            'url' => env('APP_URL').'/storage/app/filemanager',
            'visibility' => 'public',
            'throw' => false,
        ]);
        \Config::set('filesystems.disks.networks', [
            'driver' => 'local',
            'root' => storage_path('app/public/networks'),
            'url' => env('APP_URL').'/storage/networks',
            'visibility' => 'public',
            'throw' => false,
        ]);

        $this->app->register(SocializerEventServiceProvider::class);

        $this->app->singleton('nebulaGraph', function() {
            return new NebulaGraphConnection(config('database.connections.nebula'));
        });

        $this->app->singleton('redisService', function() {
            return new RedisService();
        });
    }

    /**
     * Bootstrap the application events.
     *
     * @return void
     */
    public function boot(\Illuminate\Routing\Router $router)
    {
        \Schema::defaultStringLength(191);

        /*
        |--------------------------------------------------------------------------
        | Views
        |--------------------------------------------------------------------------
        */

        // LOAD THE VIEWS
        $customViewsFolder = resource_path('views/vendor/socializer');
        // - first the published/overwritten views (in case they have any changes)
        if (file_exists($customViewsFolder)) {
            $this->loadViewsFrom($customViewsFolder, 'socializer');
        }
        // - then the stock views that come with the package, in case a published view might be missing
        $this->loadViewsFrom(realpath(__DIR__.'/resources/views'), 'socializer');

        /*
        |--------------------------------------------------------------------------
        | Routes
        |--------------------------------------------------------------------------
        */

        // Avant le chargement des routes : elles y font référence par leur nom.
        $this->registerSignalingRateLimiters();

        // LOAD THE ROUTES

        $this->app->booted(function () use ($router) {

            $this->loadRoutesFrom(__DIR__ . $this->routeFilePath);

            $this->loadRoutesFrom(__DIR__ . $this->routeChannelsFilePath);

            $this->loadRoutesFrom(__DIR__ . $this->routeApiFilePath);

            $this->loadRoutesFrom(__DIR__ . $this->routeFilePathConsole);


            // load admin routes
            Route::middleware(['web', 'admin'])
                ->group(__DIR__ . $this->routeFilePathAdmin);

            //TODO
            // - overwritten routes (in case they have any changes)
//            $customRoutesPath = base_path('routes/socializer/routes.php');
//            if (file_exists($customRoutesPath)) {
//                $this->loadRoutesFrom($customRoutesPath);
//            }

            //web middlewares
            $router->pushMiddlewareToGroup('web', \Dauvray\Estarter\app\Http\Middleware\UserActivity::class);
        });

        /*
        |--------------------------------------------------------------------------
        | Blade Components
        |--------------------------------------------------------------------------
        */

        Blade::componentNamespace('Dauvray\\Socializer\\app\\View\\Components', 'socializer');


        /*
        |--------------------------------------------------------------------------
        |
        |--------------------------------------------------------------------------
        */

        $this->loadMigrationsFrom(__DIR__.'/database/migrations');

        $this->loadTranslationsFrom(__DIR__.'/resources/lang', 'socializer');

        $this->publishes([
            __DIR__. '/resources/lang' => resource_path('lang/vendor/socializer'),
            __DIR__ . '/config/socializer.php' => config_path('socializer.php'),
            __DIR__ . '/public/vendor' => public_path('vendor'),
        ]);

        // load Helpers
        foreach (glob(__DIR__.'/app/Helpers/*.php') as $filename) {
            require_once($filename);
        }

        // user admin for all views
        View::composer('*', function ($view) {
            $view->with('adminUser', backpack_auth()->user());
        });
        /*
        |--------------------------------------------------------------------------
        | Commands
        |--------------------------------------------------------------------------
        */

        // register the artisan commands
        $this->commands([
            \Dauvray\Socializer\app\console\Commands\SocializerInstall::class,
            \Dauvray\Socializer\app\console\Commands\SocializerUpgrade::class,
            \Dauvray\Socializer\app\console\Commands\NebulaGraphPopulate::class,
            \Dauvray\Socializer\app\console\Commands\NebulaGraphClearSessions::class,
        ]);
    }

    /**
     * Plafonds serveur des routes de signalisation WebRTC (C1).
     *
     * DEUX buckets, parce que les 5 routes n'ont pas la même cadence légitime :
     *
     *  - le mesh doit encaisser une rafale de 14 demandes dans le MÊME tick au join d'une room
     *    (7 pairs × type principal + écran) ;
     *  - l'invitation d'appel naît d'un clic humain et coûte ~9 requêtes en 55 s vers UNE cible.
     *
     * Un bucket unique dimensionné pour le join laisserait donc passer ~120 invitations d'appel
     * par minute vers une victime — c'est-à-dire qu'il ne fermerait PAS le spam d'invitations,
     * qui est l'abus principal de ces routes.
     *
     * ⚠️ La clé est l'identifiant de l'ÉMETTEUR, jamais l'IP : derrière le NAT d'une entreprise,
     * une clé IP ferait que le join d'un collègue casse celui du voisin. `auth` s'exécute avant
     * `throttle` (ordre garanti par `$middlewarePriority`), donc `user()` est toujours résolu.
     *
     * ⚠️ Les plafonds sont lus À CHAQUE REQUÊTE, jamais capturés ici : c'est ce qui les rend
     * ajustables en production sans déploiement. Les valeurs par défaut sont répétées en second
     * argument parce que `mergeConfigFrom` est un `array_merge` PEU PROFOND — un hôte dont le
     * `config/socializer.php` publié porterait un `signaling` partiel écraserait toute la
     * section du paquet.
     */
    protected function registerSignalingRateLimiters(): void
    {
        RateLimiter::for('socializer-signaling', function ($request) {
            return [
                Limit::perMinute(config('socializer.signaling.throttle.mesh_per_minute', 120))
                    ->by('socializer-signaling:'.$request->user()?->getAuthIdentifier()),
            ];
        });

        RateLimiter::for('socializer-call-invite', function ($request) {
            $from = $request->user()?->getAuthIdentifier();

            return [
                // Par cible : c'est cette limite-là qui ferme le harcèlement d'un utilisateur
                // précis. Le slug vient du réseau et n'est pas encore validé (c'est C4), mais
                // `ThrottleRequests` md5-hashe la clé : sa longueur ne peut pas dégrader le cache.
                Limit::perMinute(config('socializer.signaling.throttle.invite_per_target_per_minute', 20))
                    ->by('socializer-call-invite:'.$from.':'.$request->input('toUserSlug')),

                // Globale : sans elle, la précédente se contourne en arrosant N victimes.
                Limit::perMinute(config('socializer.signaling.throttle.invite_per_minute', 40))
                    ->by('socializer-call-invite:'.$from),
            ];
        });
    }
}
