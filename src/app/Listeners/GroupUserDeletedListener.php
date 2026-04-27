<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\GroupUserDeleted;

class GroupUserDeletedListener {

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
    * @param  Verified  $event
    * @return void
    */
    public function handle(GroupUserDeleted $event) {
       // \Log::info("Le groupe_user {$event->group_user->id} a été supprimé avec le group_id {$event->group_user->group_id} et le user_id {$event->group_user->user_id}");
        app('nebulaGraph')->deleteEdge(
            config('socializer.nebulagraph.edges.registered_in.name'), 
            [
                config('socializer.nebulagraph.tags.user.name').$event->group_user->user_id.'->'.config('socializer.nebulagraph.tags.group.name').$event->group_user->group_id
            ]);
    }
}
