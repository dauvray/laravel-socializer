<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\GroupDeleted;
use Dauvray\Socializer\app\Listeners\Concerns\ToleratesGraphFailure;
use Dauvray\Socializer\app\Services\Server as ServerService;
use Dauvray\Socializer\app\Services\Users as UsersService;

class GroupDeletedListener {

    use ToleratesGraphFailure;

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
    * @param  GroupDeleted  $event
    * @return void
    */
    public function handle(GroupDeleted $event) {
        $this->syncToGraph(function () use ($event) {
            $group = $event->group;
            $serverService = new ServerService();
            $usersService = new UsersService();

            $serverService->deleteGroupServer($event->group->extras['socializer_server_vid'] ?? null);
            $usersService->deleteGroup($group);
        }, ['group_id' => $event->group->id]);
    }
}
