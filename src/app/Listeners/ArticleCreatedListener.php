<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Eblogger\app\Events\ArticleCreated;

class ArticleCreatedListener
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
    public function handle(ArticleCreated $event)
    {
        $nebula = app('nebulaGraph');
        $nebula->insertVertex(
            config('socializer.nebulagraph.tags.article.name'), 
            $nebula->populatePropsFromPattern(
                $event->article, 
                config('socializer.nebulagraph.vertices.article')
            )
        );
    }
}
