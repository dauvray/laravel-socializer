<?php

namespace Dauvray\Socializer\app\Listeners;

use Dauvray\Eblogger\app\Events\ArticleRestored;
use Dauvray\Socializer\app\Helpers\GraphTraits\BuildsArticleVertexValues;
use Dauvray\Socializer\app\Listeners\Concerns\ToleratesGraphFailure;

class ArticleRestoredListener
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
     * POURQUOI CE LISTENER EXISTE. `ArticleDeleted` part sur `static::deleting` (`Article::booted`,
     * eblogger), donc sur un SOFT delete : l'article peut revenir. Tant que la suppression du sommet
     * était un no-op — elle visait `"1"` au lieu de `"article1"` —, restaurer était sans conséquence
     * par accident. La suppression devenue effective, l'article revenait en base et son sommet non.
     *
     * Le corps est celui de la création, aux valeurs près d'aucune : c'est voulu, et
     * `BuildsArticleVertexValues` le garantit plutôt que de l'espérer. Le rejeu est inoffensif sur un
     * sommet encore présent — `insertVertex` émet un `INSERT VERTEX IF NOT EXISTS`, qui ne réécrit
     * ni les propriétés ni le `created_at`.
     *
     * ⚠️ Ne repose PAS l'arête d'auteur, que la suppression a pourtant emportée (`WITH EDGE`).
     * Parité stricte avec la création, qui ne l'a jamais posée non plus : seul
     * `GraphProjection::projectArticleAuthors()` le fait. Ce trou est réel mais il est celui de la
     * création, pas de la restauration — le fermer ici ferait diverger deux chemins d'écriture.
     * Consigné dans `work/projection-graphe-todo.md`.
     *
     * @return void
     */
    public function handle(ArticleRestored $event)
    {
        $nebula = app('nebulaGraph');

        $this->syncToGraph(fn () => $nebula->insertVertex(
            config('socializer.nebulagraph.tags.article.name'),
            $this->articleVertexValues($nebula, $event->article)
        ), ['article_id' => $event->article->id]);
    }
}
