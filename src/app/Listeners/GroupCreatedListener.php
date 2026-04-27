<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\GroupCreated;
use Dauvray\Socializer\app\Services\Server as ServerService;
use Dauvray\Socializer\app\Services\Users as UsersService;

class GroupCreatedListener {

    /**
    * Create the event listener.
    *
    * @return void
    */
    public function __construct() {
        //
    }

    /**
    * Handle the event.
    *
    * @param  GroupCreated  $event
    * @return void
    */
    public function handle(GroupCreated $event) 
    {
        $serverService = new ServerService();
        $usersService = new UsersService();

        $group_vid = $usersService->createGroup($event->group);
        setGroupHasParentRelation($event->group);

        // create a server
        $server_vid = $serverService->createGroupServer(
            [
                'name' => $event->group->name,
                'privacy' => 1,
            ], 
            $group_vid
        );

        // keep server_vid
        $extras = $event->group->extras;
        $extras['socializer_server_vid'] = $server_vid;
        $event->group->extras = $extras;
        $event->group->save();
    }
}
