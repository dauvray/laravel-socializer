<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\UserDisconnected;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Cache;

class UserDisconnectedListener
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
    public function handle(UserDisconnected $event)
    {
       app('nebulaGraph')->updateVertex(
            config('socializer.nebulagraph.tags.user.name'), 
            $event->user->vertexid, 
            ['connected' => 0]
        );

        // broadcast new status
        Broadcast::on('user-status.'. $event->user->slug)
        ->as('userStatusUpdated')
        ->with([
            'status' => 0,
            'slug' => $event->user->slug,
            ])
        ->send();

        Cache::forget('user-is-online-' . $event->user->id);
    }
}
