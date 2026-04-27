<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\GroupUpdated;

class GroupUpdatedListener {

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
    public function handle(GroupUpdated $event) {
        $event->group->identifier = hideIdentifier($event->group);

        $values = app('nebulaGraph')->populatePropsFromPattern( $event->group, config('socializer.nebulagraph.vertices.group'));
        app('nebulaGraph')->updateVertex('group', getVertexId($event->group), $values);

        // met a jour le lien avec le parent
        setGroupHasParentRelation($event->group);
    }
}
