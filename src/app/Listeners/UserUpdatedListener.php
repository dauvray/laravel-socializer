<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\UserUpdated;

class UserUpdatedListener
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
    public function handle(UserUpdated $event)
    {
        $nebula = app('nebulaGraph');

        $nebula->updateVertex(
            config('socializer.nebulagraph.tags.user.name'), 
            $event->user->vertexid,
            array_merge(
                $nebula->populatePropsFromPattern(
                    getAPIResourceData( \Dauvray\Socializer\app\Http\Resources\User::class, $event->user),
                    config('socializer.nebulagraph.vertices.user')
                ),
                [
                'identifier' => hideIdentifier($event->user),
                'active' => (int)$event->user->active,
                ]
            )
        );
    }
}
