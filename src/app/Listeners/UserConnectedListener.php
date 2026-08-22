<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\UserConnected;
use Dauvray\Socializer\app\Listeners\Concerns\ToleratesGraphFailure;
use Illuminate\Support\Facades\Broadcast;

class UserConnectedListener
{
    use ToleratesGraphFailure;

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
        // Le rattrapage est CE QUI PERMET au broadcast ci-dessous de partir quand même : le
        // statut de présence est diffusé en temps réel, il n'a pas à dépendre de l'écriture de
        // sa trace dans le réplica.
        $this->syncToGraph(fn () => app('nebulaGraph')->updateVertex(
            config('socializer.nebulagraph.tags.user.name'),
            $event->user->vertexid,
            ['connected' => 1]
        ), ['user_vertexid' => $event->user->vertexid]);

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
