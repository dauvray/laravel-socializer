<?php

namespace Dauvray\Socializer\Tests\Feature\Graph;

use Dauvray\Eblogger\app\Events\ArticleCreated;
use Dauvray\Eblogger\app\Events\ArticleDeleted;
use Dauvray\Eblogger\app\Models\Article;
use Dauvray\Socializer\app\Listeners\ArticleCreatedListener;
use Dauvray\Socializer\app\Listeners\ArticleDeletedListener;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\Test;

/**
 * Les trois écrivains du sommet `article` s'accordent sur un vid dérivé du modèle.
 *
 * LE DÉFAUT. `ArticleDeletedListener` visait
 * `config('socializer.nebulagraph.vertices.article.id')` — une clé qui N'EXISTE PAS,
 * `vertices.article` ne contenant qu'`identifier`. L'expression valait donc `''.$article->id`,
 * soit `"1"` au lieu de `"article1"` : la suppression ne touchait rien, sans erreur, et le sommet
 * survivait à son article.
 *
 * ET SON SYMÉTRIQUE, sans lequel corriger la clé n'aurait rien corrigé : `ArticleCreatedListener`
 * appelait `insertVertex()` SANS `id` explicite. `Article` n'ayant ni `Socializable` ni
 * `Commentable`, `populatePropsFromPattern` n'en fournit pas non plus, et le sommet naissait sous
 * `uniqidReal()` — jamais `article<id>`. Une suppression corrigée aurait trouvé les sommets nés
 * d'une PROJECTION (`GraphProjection::projectArticles()` pose bien l'`id`) et serait restée sans
 * effet sur tout article créé en ligne. C'est le cas particulier du piège que
 * `docs/architecture/projection-graphe.md` énonce en général : tout sommet créé sans `id`
 * explicite est dupliqué à chaque passage, et introuvable pour qui le cherche par son id dérivé.
 *
 * D'où la forme du test central : il n'asserte pas deux chaînes indépendamment, il vérifie que la
 * suppression vise CE QUE LA CRÉATION A POSÉ. C'est la seule formulation qu'aucune des deux
 * moitiés du défaut ne peut satisfaire seule.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. `FakeNebulaGraph::insertVertex` ne rend que le vid dans le
 * nGQL qu'elle journalise (`"article12":()`), jamais les propriétés : l'alignement de
 * l'`identifier` sur celui de la projection (`hideIdentifier($article)`, là où le sommet créé en
 * ligne portait `NULL`) n'est donc pas observable ici. Il voyage dans le même `array_merge` que
 * l'`id`, qui l'est. Sa contre-épreuve est manuelle : lire l'`identifier` d'un sommet `article`
 * créé par l'application.
 */
class ArticleVertexTest extends TestCase
{
    /*
    |--------------------------------------------------------------------------
    | 1. L'id est dérivé du modèle, à la création comme à la suppression
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function la_creation_pose_un_id_derive_du_modele(): void
    {
        $graphe = $this->fakeNebulaGraph()->always([]);

        (new ArticleCreatedListener)->handle(new ArticleCreated(new Article(12)));

        // `assertSame` sur le tableau entier, et pas `assertContains` : une seule requête doit
        // partir, et son vid doit être dérivé — pas le `vid-aleatoire-article` de la doublure,
        // qui reproduit le repli `uniqidReal()` de la production.
        $this->assertSame(
            ['INSERT VERTEX IF NOT EXISTS article VALUES "article12":()'],
            $graphe->queries()
        );
    }

    /**
     * LE test de ce fichier : les deux moitiés du défaut se voyaient l'une l'autre, aucune ne se
     * voyait seule.
     */
    #[Test]
    public function la_suppression_vise_le_sommet_que_la_creation_a_pose(): void
    {
        $graphe = $this->fakeNebulaGraph()->always([]);

        $article = new Article(12);

        (new ArticleCreatedListener)->handle(new ArticleCreated($article));
        (new ArticleDeletedListener)->handle(new ArticleDeleted($article));

        $requetes = $graphe->queries();

        $this->assertCount(2, $requetes, 'Une création puis une suppression, pas plus.');

        $this->assertSame(
            1,
            preg_match('/VALUES "([^"]+)"/', $requetes[0], $pose),
            'Le vid posé à la création est illisible : la doublure a changé de forme.'
        );

        $this->assertSame('DELETE VERTEX "'.$pose[1].'" WITH EDGE', $requetes[1]);
    }

    /**
     * Le pendant de l'idempotence de `createUserAndNetwork` : sur un id stable,
     * `INSERT VERTEX IF NOT EXISTS` fait le reste côté serveur. Sur un `uniqidReal()`, chaque
     * passage posait un sommet de plus.
     */
    #[Test]
    public function deux_creations_du_meme_article_visent_le_meme_sommet(): void
    {
        $graphe = $this->fakeNebulaGraph()->always([]);

        (new ArticleCreatedListener)->handle(new ArticleCreated(new Article(12)));
        (new ArticleCreatedListener)->handle(new ArticleCreated(new Article(12)));

        [$premiere, $seconde] = $graphe->queries();

        $this->assertSame($premiere, $seconde);
        $this->assertStringNotContainsString('vid-aleatoire', $premiere);
    }

    /*
    |--------------------------------------------------------------------------
    | 2. Le rattrapage d'E7 est bien câblé sur ce listener aussi
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function un_refus_du_graphe_a_la_suppression_est_journalise_et_ne_leve_pas(): void
    {
        $this->fakeNebulaGraph()->throwsOn('DELETE VERTEX');

        Log::spy();

        // Aucune exception ne doit traverser : MySQL est la source de vérité, la suppression de
        // l'article ne doit pas échouer parce qu'une COPIE n'a pas pu être retirée.
        (new ArticleDeletedListener)->handle(new ArticleDeleted(new Article(12)));

        Log::shouldHaveReceived('error')
            ->withArgs(fn (string $message, array $context) => ($context['listener'] ?? null) === ArticleDeletedListener::class
                && ($context['article_id'] ?? null) === 12
                && ($context['code'] ?? null) === -1004)
            ->once();
    }
}
