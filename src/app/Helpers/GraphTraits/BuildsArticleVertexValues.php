<?php

namespace Dauvray\Socializer\app\Helpers\GraphTraits;

/**
 * Les valeurs du sommet `article` — LE seul endroit où elles se construisent.
 *
 * POURQUOI CE TRAIT EXISTE. Quatre chemins écrivent ce sommet : `ArticleCreatedListener`,
 * `ArticleRestoredListener`, `ArticleDeletedListener` (le vid seul) et
 * `GraphProjection::projectArticles()`. Ils ont vécu en COPIES, et ces copies ont dérivé : la
 * suppression bâtissait son vid sur `vertices.article.id`, une clé qui n'existe pas, quand les
 * autres le bâtissaient sur `tags.article.name`. Résultat, `DELETE VERTEX "1"` — une suppression qui
 * ne touchait rien, en silence, depuis toujours. Une seule copie ne peut plus diverger.
 *
 * ⚠️ L'`id` est posé ICI, et c'est indispensable. `populatePropsFromPattern` ne le fournit que si le
 * modèle expose `vertexId` — l'accesseur des traits `Socializable` / `Commentable` —, et l'`Article`
 * d'eblogger n'a ni l'un ni l'autre. Sans cette ligne, `insertVertex` retombe sur `uniqidReal()` :
 * un sommet de plus à chaque passage, et introuvable pour qui le cherche par son id dérivé.
 * Cf. `docs/architecture/projection-graphe.md`, épinglé par `ArticleVertexTest`.
 *
 * ⚠️ `$nebula` n'est délibérément pas typé sur `NebulaGraphConnection` : le harnais substitue
 * `Tests\Stubs\FakeNebulaGraph` au binding `nebulaGraph`, et cette doublure n'en hérite PAS.
 */
trait BuildsArticleVertexValues
{
    /**
     * @param  mixed  $nebula  le binding `nebulaGraph` — connexion réelle ou doublure
     * @param  mixed  $article  le modèle d'eblogger, paquet optionnel donc non typable ici
     * @return array<string, mixed>
     */
    protected function articleVertexValues(mixed $nebula, mixed $article): array
    {
        return array_merge(
            $nebula->populatePropsFromPattern(
                $article,
                config('socializer.nebulagraph.vertices.article')
            ),
            [
                'id' => config('socializer.nebulagraph.tags.article.name').$article->id,
                'identifier' => hideIdentifier($article),
            ]
        );
    }
}
