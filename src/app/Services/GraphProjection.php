<?php

namespace Dauvray\Socializer\app\Services;

use Dauvray\Socializer\app\Exceptions\NebulaGraphException;
use Dauvray\Socializer\app\Helpers\GraphTraits\BuildsArticleVertexValues;
use Dauvray\Socializer\app\Services\Server as ServerService;

/**
 * Projection de MySQL vers le réplica NebulaGraph — LE seul endroit où vit ce DML.
 *
 * POURQUOI CETTE CLASSE EXISTE. Ce peuplement avait deux copies : la migration `create_nebula` et
 * la commande `socializer:nebula-populate`. Deux points d'entrée se justifient — l'un à
 * l'installation, l'autre à la demande, une migration ne se rejouant que par un `migrate:rollback`
 * qui `dropSpace` tout. Deux COPIES, non : elles avaient déjà dérivé (la migration projetait les
 * serveurs de groupes et le `marketplace`, la commande les avait oubliés ; le durcissement des
 * écritures a dû patcher les deux fichiers), et surtout le déroulé prévu — installer, puis
 * rattraper — jouait deux fois un peuplement non idempotent, ce qui donnait 2 murs et 2 feeds par
 * utilisateur. Cf. `createUserAndNetwork()`.
 *
 * QUI DÉCIDE QUOI. Cette classe COMPTE et RAPPORTE, elle ne décide pas : elle rend le nombre
 * d'écritures refusées et laisse chaque appelant en tirer sa conclusion — la migration lève et
 * n'est donc pas enregistrée, la commande sort en code d'erreur.
 *
 * LE RATTRAPAGE EST PAR ITEM. Laisser la première exception traverser la boucle ferait perdre tout
 * ce qui a déjà été projeté à cause d'un seul enregistrement bancal — typiquement
 * `$article->author->id` sur un auteur supprimé. Et seule `NebulaGraphException` est rattrapée :
 * une `TypeError` ici est un bug de projection, pas une panne de réplica, elle doit remonter (même
 * raisonnement que `ToleratesGraphFailure`).
 */
class GraphProjection
{
    use BuildsArticleVertexValues;

    public $nebula = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
    }

    /**
     * Les étapes jouables partout, y compris en console.
     *
     * @param  callable(string, array<string, mixed>):void|null  $onFailure  quoi, contexte
     * @return int  nombre d'écritures refusées par le graphe
     */
    public function projectAll(?callable $onFailure = null): int
    {
        $echecs = 0;
        $tenter = $this->tentative($onFailure, $echecs);

        $this->projectGroupParents($tenter);
        $this->projectUsers($tenter);
        $this->projectArticles($tenter);
        $this->projectMarketplace($tenter);

        // Pause héritée de la migration : le graphe est asynchrone, les arêtes d'auteur sont posées
        // après que les sommets d'article se sont installés. Le harnais de test la met à 0.
        sleep((int) config('socializer.nebulagraph.sleeping_duration'));

        $this->projectArticleAuthors($tenter);

        return $echecs;
    }

    /**
     * Les serveurs de groupes — hors de `projectAll`, et ce n'est pas un oubli.
     *
     * `Server::createGroupServer` EXIGE un utilisateur authentifié (sa chaîne descend jusqu'à
     * `Page::createPageVertice`, qui lit `Auth::user()`). L'étape n'est donc pas jouable depuis une
     * commande : appelée sans acteur elle se refuse, journalise, et ne compte pas comme une écriture
     * refusée par le graphe — sinon un `migrate` échouerait sur toute base ayant des groupes.
     *
     * Seule la migration l'appelle. La rendre jouable en console est un chantier à part,
     * cf. `work/README.md`.
     *
     * @param  callable(string, array<string, mixed>):void|null  $onFailure
     */
    public function projectGroupServers(?callable $onFailure = null): int
    {
        $echecs = 0;
        $tenter = $this->tentative($onFailure, $echecs);
        $model = config('estarter.models.group');

        if(!$model) {
            return $echecs;
        }

        $serverService = new ServerService();

        foreach($model::all() as $group) {
            $tenter(fn () => $serverService->createGroupServer(
                [
                    'name' => $group->name,
                    'privacy' => 1,
                ],
                getVertexId($group)
            ), "serveur du groupe {$group->id}");
        }

        return $echecs;
    }

    /**
     * Rattrapage par item : incrémente le compte et rapporte, sans interrompre la boucle.
     *
     * @param  callable(string, array<string, mixed>):void|null  $onFailure
     * @return callable(callable, string):void
     */
    private function tentative(?callable $onFailure, int &$echecs): callable
    {
        return function (callable $ecriture, string $quoi) use ($onFailure, &$echecs): void {
            try {
                $ecriture();
            } catch (NebulaGraphException $e) {
                $echecs++;

                if($onFailure) {
                    $onFailure($quoi, $e->context());
                }
            }
        };
    }

    private function projectGroupParents(callable $tenter): void
    {
        $model = config('estarter.models.group');

        if(!$model) {
            return;
        }

        foreach($model::all() as $group) {
            $tenter(fn () => setGroupHasParentRelation($group), "parent du groupe {$group->id}");
        }
    }

    private function projectUsers(callable $tenter): void
    {
        $model = config('estarter.models.user');

        if(!$model) {
            return;
        }

        foreach($model::all() as $user) {
            $tenter(fn () => createUserAndNetwork($user), "réseau de l'utilisateur {$user->id}");
        }
    }

    /**
     * Le garde sur la clé de config n'est pas défensif pour rien : `eblogger` est un paquet
     * OPTIONNEL. Sans lui, `config('eblogger.models.article')` rend `null` et l'appel statique
     * `null::all()` est un fatal — ce que les deux copies de ce DML faisaient sans condition.
     *
     * Les valeurs du sommet — dont l'`id`, que ce modèle ne peut pas fournir seul — viennent de
     * `BuildsArticleVertexValues`, partagé avec les listeners de création et de restauration : le
     * pourquoi y est écrit une fois. C'est ce partage qui rend impossible la divergence dont ce
     * sommet a déjà été victime.
     */
    private function projectArticles(callable $tenter): void
    {
        $model = config('eblogger.models.article');

        if(!$model) {
            return;
        }

        foreach($model::all() as $article) {
            $tenter(fn () => $this->nebula->insertVertex(
                config('socializer.nebulagraph.tags.article.name'),
                $this->articleVertexValues($this->nebula, $article)
            ), "article {$article->id}");
        }
    }

    private function projectArticleAuthors(callable $tenter): void
    {
        $model = config('eblogger.models.article');

        if(!$model) {
            return;
        }

        foreach($model::all() as $article) {
            // relie article et auteur
            $tenter(fn () => setHasCreatorRelation(
                config('socializer.nebulagraph.tags.article.name').$article->id,
                config('socializer.nebulagraph.tags.user.name').$article->author->id
            ), "auteur de l'article {$article->id}");
        }
    }

    private function projectMarketplace(callable $tenter): void
    {
        $tenter(fn () => $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.marketplace.name'),
            ['id' => 'marketplace']
        ), 'marketplace');
    }
}
