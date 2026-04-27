<?php

namespace Dauvray\Socializer\app\Providers;

use Illuminate\Foundation\Support\Providers\EventServiceProvider as ServiceProvider;
use Illuminate\Support\Facades\Event;
use Laravel\Reverb\Events\MessageReceived;
use Dauvray\Socializer\app\Listeners\UserOnlineWhisperListener;

class SocializerEventServiceProvider extends ServiceProvider
{
    /**
     * The event listener mappings for the application.
     *
     * @var array
     */
    protected $listen = [
        /*
        |-----------------------------------------------------------
        | USER
        |-----------------------------------------------------------
        */
        'Dauvray\Estarter\app\Events\UserConnected' => [
            'Dauvray\Socializer\app\Listeners\UserConnectedListener',
        ],
        'Dauvray\Estarter\app\Events\UserDisconnected' => [
            'Dauvray\Socializer\app\Listeners\UserDisconnectedListener',
        ],
        'Dauvray\Estarter\app\Events\UserUpdated' => [
            'Dauvray\Socializer\app\Listeners\UserUpdatedListener',
        ],
        'Dauvray\Estarter\app\Events\UserCreated' => [
            'Dauvray\Socializer\app\Listeners\UserCreatedListener',
        ],
        /*
        |-----------------------------------------------------------
        | COMMENTS
        |-----------------------------------------------------------
        */
        'Dauvray\Socializer\app\Events\CommentCreated' => [
            'Dauvray\Socializer\app\Listeners\CommentCreatedListener',
        ],
        'Dauvray\Socializer\app\Events\CommentDeleted' => [
            'Dauvray\Socializer\app\Listeners\CommentDeletedListener',
        ],
        /*-------------------------------
        | Group Events / Listeners
        |-------------------------------*/
        'Dauvray\Estarter\app\Events\GroupCreated' => [
            'Dauvray\Socializer\app\Listeners\GroupCreatedListener',
        ],
        'Dauvray\Estarter\app\Events\GroupDeleted' => [
            'Dauvray\Socializer\app\Listeners\GroupDeletedListener',
        ],
        'Dauvray\Estarter\app\Events\GroupUpdated' => [
            'Dauvray\Socializer\app\Listeners\GroupUpdatedListener',
        ],
        'Dauvray\Estarter\app\Events\GroupUserCreated' => [
            'Dauvray\Socializer\app\Listeners\GroupUserCreatedListener',
        ],
        'Dauvray\Estarter\app\Events\GroupUserDeleted' => [
            'Dauvray\Socializer\app\Listeners\GroupUserDeletedListener',
        ],
    ];

    public function __construct($app)
    {
        // Optional Listeners
        if(config('eblogger')) {
            $this->listen['Dauvray\Eblogger\app\Events\ArticleCreated'] = [
                'Dauvray\Socializer\app\Listeners\ArticleCreatedListener',
            ];
            $this->listen['Dauvray\Eblogger\app\Events\ArticleDeleted'] = [
                'Dauvray\Socializer\app\Listeners\ArticleDeletedListener',
            ];
        }

        parent::__construct($app);
    }

    /**
     * Register any events for your application.
     *
     * @return void
     */
    public function boot()
    {
        parent::boot();

        // Register the User Reverb ping handler
        Event::listen(MessageReceived::class, UserOnlineWhisperListener::class);
    }
}
