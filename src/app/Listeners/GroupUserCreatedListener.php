<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\GroupUserCreated;

class GroupUserCreatedListener {

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
    * @param  GroupUserCreated  $event
    * @return void
    */
    public function handle(GroupUserCreated $event) {
       // \Log::info("Le groupe_user {$event->group_user->id} a été créé avec le group_id {$event->group_user->group_id} et le user_id {$event->group_user->user_id}");
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.registered_in.name'), 
            [
                config('socializer.nebulagraph.tags.user.name').$event->group_user->user_id .'->'. config('socializer.nebulagraph.tags.group.name').$event->group_user->group_id => [
                    // ces props sont à titre d'exemple, à vous de voir ce que vous voulez stocker dans les relations
                    // mais les props doivent etre definies dans le schema de l'edge dans NebulaGraph avant de les utiliser
                    // 'is_leader' => $event->group_user->is_leader ? 'true' : 'false',
                    // 'job_title' => $event->group_user->job_title ?? '',
                ]
            ]
        );
    }
}
