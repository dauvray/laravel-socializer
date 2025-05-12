<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\UserConnected;
use Illuminate\Support\Facades\Broadcast;

class UserConnectedListener
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
    public function handle(UserConnected $event)
    {
       app('nebulaGraph')->updateVertex(
            config('socializer.nebulagraph.tags.user.name'), 
            $event->user->vertexid, 
            ['connected' => 1]
        );

         // broadcast new status
        Broadcast::on('user-status.'. $event->user->slug)
            ->as('userStatusUpdated')
            ->with([
                'status' => 1,
                'slug' => $event->user->slug,
                ])
            ->send();

    }
}
