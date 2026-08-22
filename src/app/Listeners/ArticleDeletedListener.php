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
     * ⚠️ Le vid se construit sur `tags.article.name`, comme à la création et dans
     * `GraphProjection`. Il a longtemps été bâti sur `vertices.article.id` — une clé qui n'existe
     * pas : l'expression valait `''.$id`, donc `"1"`, et la suppression ne touchait rien en
     * silence. Épinglé par `ArticleVertexTest`.
     *
     * @return void
     */
    public function handle(ArticleDeleted $event)
    {
        $nebula = app('nebulaGraph');

        $this->syncToGraph(
            fn () => $nebula->deleteVertex([config('socializer.nebulagraph.tags.article.name').$event->article->id], true),
            ['article_id' => $event->article->id]
        );
    }
}
