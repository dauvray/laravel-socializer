<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Eblogger\app\Events\ArticleCreated;
use Dauvray\Socializer\app\Listeners\Concerns\ToleratesGraphFailure;

class ArticleCreatedListener
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
     * ⚠️ L'`id` est posé ICI, exactement comme dans `GraphProjection::projectArticles()`.
     * `populatePropsFromPattern` ne le fournit que si le modèle expose `vertexId` — l'accesseur des
     * traits `Socializable` / `Commentable` —, et l'`Article` d'eblogger n'a ni l'un ni l'autre :
     * sans cette ligne, `insertVertex` retombe sur `uniqidReal()`. Le sommet était donc dupliqué à
     * chaque passage, introuvable pour la suppression, et l'arête d'auteur de
     * `projectArticleAuthors` — qui vise `article<id>` depuis toujours — pendait dans le vide.
     * Épinglé par `ArticleVertexTest`.
     *
     * @return void
     */
    public function handle(ArticleCreated $event)
    {
        $nebula = app('nebulaGraph');

        $this->syncToGraph(fn () => $nebula->insertVertex(
            config('socializer.nebulagraph.tags.article.name'),
            array_merge(
                $nebula->populatePropsFromPattern(
                    $event->article,
                    config('socializer.nebulagraph.vertices.article')
                ),
                [
                    'id' => config('socializer.nebulagraph.tags.article.name').$event->article->id,
                    'identifier' => hideIdentifier($event->article),
                ]
            )
        ), ['article_id' => $event->article->id]);
    }
}
