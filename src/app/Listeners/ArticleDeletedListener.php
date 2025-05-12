<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Eblogger\app\Events\ArticleDeleted;

class ArticleDeletedListener
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
    public function handle(ArticleDeleted $event)
    {
        $nebula = app('nebulaGraph');
        $nebula->deleteVertex([ config('socializer.nebulagraph.vertices.article.id').$event->article->id ], true);
    }
}
