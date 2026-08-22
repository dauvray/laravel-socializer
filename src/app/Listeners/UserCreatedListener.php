<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\UserCreated;
use Dauvray\Socializer\app\Listeners\Concerns\ToleratesGraphFailure;

class UserCreatedListener
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
    public function handle(UserCreated $event)
    {
        // `createUserAndNetwork` enchaîne 3 `insertVertex` et 4 `insertEdge` : le rattrapage est
        // ici, autour de la chaîne entière. Un compte à moitié projeté dans le graphe est un cas
        // de re-synchronisation (E4.2), pas une raison de refuser la CRÉATION DU COMPTE.
        $this->syncToGraph(
            fn () => createUserAndNetwork($event->user),
            ['user_vertexid' => $event->user->vertexid ?? null, 'user_id' => $event->user->id]
        );
    }
}
