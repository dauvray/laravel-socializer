<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\GroupCreated;
use Dauvray\Socializer\app\Listeners\Concerns\ToleratesGraphFailure;
use Dauvray\Socializer\app\Services\Server as ServerService;
use Dauvray\Socializer\app\Services\Users as UsersService;

class GroupCreatedListener {

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
    * @param  GroupCreated  $event
    * @return void
    */
    public function handle(GroupCreated $event) 
    {
        // La chaîne entière est dans le rattrapage, `save()` compris : si le serveur n'a pas pu
        // être créé, il ne faut SURTOUT PAS enregistrer un `socializer_server_vid` qui pointerait
        // vers un sommet inexistant. Le groupe MySQL, lui, reste créé — c'est la source de vérité.
        $this->syncToGraph(function () use ($event) {
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
        }, ['group_id' => $event->group->id]);
    }
}
