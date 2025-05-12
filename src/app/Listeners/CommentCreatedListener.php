<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Socializer\app\Events\CommentCreated;

class CommentCreatedListener
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
    public function handle(CommentCreated $event)
    {

    }
}
