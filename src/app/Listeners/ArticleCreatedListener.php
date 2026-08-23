<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Eblogger\app\Events\ArticleCreated;
use Dauvray\Socializer\app\Helpers\GraphTraits\BuildsArticleVertexValues;
use Dauvray\Socializer\app\Listeners\Concerns\ToleratesGraphFailure;

class ArticleCreatedListener
{
    use BuildsArticleVertexValues;
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
     * Les valeurs du sommet — dont l'`id`, que ce modèle ne peut pas fournir seul — viennent de
     * `BuildsArticleVertexValues`, partagé avec `ArticleRestoredListener` et
     * `GraphProjection::projectArticles()` : le pourquoi y est écrit une fois.
     *
     * ⚠️ Ne pose PAS l'arête d'auteur, que seul `projectArticleAuthors()` écrit — cf.
     * `work/projection-graphe-todo.md`.
     *
     * @return void
     */
    public function handle(ArticleCreated $event)
    {
        $nebula = app('nebulaGraph');

        $this->syncToGraph(fn () => $nebula->insertVertex(
            config('socializer.nebulagraph.tags.article.name'),
            $this->articleVertexValues($nebula, $event->article)
        ), ['article_id' => $event->article->id]);
    }
}
