<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\UserCreated;

class UserCreatedListener
{
    /**
     * Create the event listener.
     *
     * @return void
     */
    public function __construct()
    {
        //
    }

    /**
     * Handle the event.
     *
     * @param  Verified  $event
     * @return void
     */
    public function handle(UserCreated $event)
    {
        createUserAndNetwork($event->user);
    }
}
