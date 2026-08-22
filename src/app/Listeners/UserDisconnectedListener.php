<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\UserDisconnected;
use Dauvray\Socializer\app\Listeners\Concerns\ToleratesGraphFailure;
use Illuminate\Support\Facades\Broadcast;

class UserDisconnectedListener
{
    use ToleratesGraphFailure;

     public $service;

    /**
     * Create the event listener.
     *
     * @return void
     */
    public function __construct()
    {

    }

    /**
     * Handle the event.
     *
     * @param  Verified  $event
     * @return void
     */
    public function handle(UserDisconnected $event)
    {
        // Sans ce rattrapage, une panne du réplica empêcherait le retrait du statut de présence
        // et la diffusion qui suit : l'utilisateur resterait affiché « en ligne » à tous.
        $this->syncToGraph(fn () => app('nebulaGraph')->updateVertex(
            config('socializer.nebulagraph.tags.user.name'),
            $event->user->vertexid,
            ['connected' => 0]
        ), ['user_vertexid' => $event->user->vertexid]);

        app('onlineUsers')->removeUserOnlineStatus();

        // broadcast new status
        Broadcast::on('user-status.'. $event->user->slug)
        ->as('userStatusUpdated')
        ->with([
            'status' => 0,
            'slug' => $event->user->slug,
            ])
        ->send();
    }
}
