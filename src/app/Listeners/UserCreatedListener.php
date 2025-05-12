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
        $nebula = app('nebulaGraph');

        $nebula->insertVertex(
            config('socializer.nebulagraph.tags.user.name'), 
            array_merge(
                $nebula->populatePropsFromPattern(
                    getAPIResourceData( \Dauvray\Socializer\app\Http\Resources\User::class, $event->user), 
                    config('socializer.nebulagraph.vertices.user')
                ),
                [
                'identifier' => hideIdentifier($event->user)
                ]
            )
        );
    }
}
