<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Eblogger\app\Events\ArticleDeleted;
use Dauvray\Socializer\app\Listeners\Concerns\ToleratesGraphFailure;

class ArticleDeletedListener
{
    use ToleratesGraphFailure;

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

        $this->syncToGraph(
            fn () => $nebula->deleteVertex([ config('socializer.nebulagraph.vertices.article.id').$event->article->id ], true),
            ['article_id' => $event->article->id]
        );
    }
}
