<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Estarter\app\Events\GroupUpdated;
use Dauvray\Socializer\app\Listeners\Concerns\ToleratesGraphFailure;

class GroupUpdatedListener {

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
    * @param  Verified  $event
    * @return void
    */
    public function handle(GroupUpdated $event) {
        $event->group->identifier = hideIdentifier($event->group);

        // Les DEUX écritures sont dans le même rattrapage : `setGroupHasParentRelation` finit
        // par `setRegisteredRelation`, donc `insertEdge`. N'en couvrir qu'une laisserait l'autre
        // remonter.
        $this->syncToGraph(function () use ($event) {
            $values = app('nebulaGraph')->populatePropsFromPattern( $event->group, config('socializer.nebulagraph.vertices.group'));
            app('nebulaGraph')->updateVertex('group', getVertexId($event->group), $values);

            // met a jour le lien avec le parent
            setGroupHasParentRelation($event->group);
        }, ['group_id' => $event->group->id]);
    }
}
