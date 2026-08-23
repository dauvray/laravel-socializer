<?php

namespace Dauvray\Socializer\app\Services;

use Dauvray\Socializer\app\Exceptions\NebulaGraphException;
use Dauvray\Socializer\app\Helpers\GraphTraits\BuildsArticleVertexValues;
use Dauvray\Socializer\app\Services\Server as ServerService;
use Dauvray\Socializer\app\Services\Users as UsersService;
use Illuminate\Support\Facades\DB;

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
     * Toutes les étapes, et elles sont toutes jouables en console.
     *
     * L'ORDRE COMPTE À UN ENDROIT : les groupes avant leurs serveurs. L'arête `owned_by` d'un
     * serveur vise le sommet du groupe, et un sommet NebulaGraph n'existe que s'il porte un tag —
     * une arête vers un sommet jamais posé ne fait pas exister ce sommet, elle pend. Le reste est
     * insensible à l'ordre : les arêtes tolèrent que leur cible arrive après elles.
     *
     * @param  callable(string, array<string, mixed>):void|null  $onFailure  quoi, contexte
     * @return int  nombre d'écritures refusées par le graphe
     */
    public function projectAll(?callable $onFailure = null): int
    {
        $echecs = 0;
        $tenter = $this->tentative($onFailure, $echecs);

        $this->projectGroups($tenter);
        $this->projectUsers($tenter);
        $this->projectGroupServers($tenter);
        $this->projectArticles($tenter);
        $this->projectMarketplace($tenter);

        // Pause héritée de la migration : le graphe est asynchrone, les arêtes d'auteur sont posées
        // après que les sommets d'article se sont installés. Le harnais de test la met à 0.
        sleep((int) config('socializer.nebulagraph.sleeping_duration'));

        $this->projectArticleAuthors($tenter);

        return $echecs;
    }

    /**
     * Les serveurs de groupes, leur page, et le vid mémorisé côté MySQL.
     *
     * ⚠️ LE `save()` EST DANS LA TENTATIVE, comme dans `GroupCreatedListener` : `extras`
     * `socializer_server_vid` est la poignée par laquelle le front entre dans le serveur
     * (`Resources\User`) et par laquelle `GroupDeletedListener` le supprime. Mémoriser un vid dont
     * l'écriture graphe a échoué donnerait au front l'adresse d'un sommet inexistant. Jusqu'ici
     * cette étape JETAIT le vid : un serveur projeté était un orphelin, invisible et non
     * supprimable.
     *
     * `extras` est écrit, jamais relu : la relecture d'idempotence interroge le graphe, seule source
     * qui ne peut pas désigner un sommet supprimé.
     *
     * Le groupe sans membre, lui, n'est pas projeté : `createGroupServer` s'y refuse et journalise.
     * Une étape qui ne PEUT pas s'exécuter n'est pas une écriture refusée par le graphe.
     *
     * ⚠️ Étape PRIVÉE depuis qu'elle est jouable en console : elle était publique et portait son
     * propre compteur, parce que seule la migration l'appelait, à côté de `projectAll()`. Deux
     * compteurs pour une même projection étaient une addition à la main dans l'appelant — et la
     * source d'un `$onFailure` reçu à la place d'un `$tenter`.
     */
    private function projectGroupServers(callable $tenter): void
    {
        $model = config('estarter.models.group');

        if(!$model) {
            return;
        }

        $serverService = new ServerService();

        foreach($model::all() as $group) {
            $tenter(function () use ($serverService, $group) {
                $vid = $serverService->createGroupServer(
                    [
                        'name' => $group->name,
                        'privacy' => 1,
                    ],
                    getVertexId($group),
                    $this->resolveGroupOwner($group)
                );

                if (!$vid) {
                    return;
                }

                $extras = $group->extras ?? [];
                $extras['socializer_server_vid'] = $vid;
                $group->extras = $extras;
                $group->save();
            }, "serveur du groupe {$group->id}");
        }
    }

    /**
     * Qui possède ce qu'une projection écrit pour un groupe : son leader, sinon son plus ancien
     * membre.
     *
     * En console `Auth::user()` rend `null`, et deux écritures ont pourtant besoin d'un acteur : le
     * `model_id` / `model_type` du document Mongo de la page du serveur, et l'arête `has_creator` du
     * groupe — celle que `Socializable::isServerOwner` traverse pour dire qui administre le serveur.
     * Le leader du groupe est la seule réponse que MySQL sache donner sans rien inventer.
     *
     * ⚠️ Requête directe sur le pivot, et non `$group->users()` : même raison que
     * `Socializable::sharesGroupWith` — cette relation vit sur `EstarterUser`, d'un paquet que le
     * harnais de tests remplace par un stub qui lève. Même clé de config pour le nom de table.
     *
     * @param  mixed  $group
     * @return mixed|null le modèle utilisateur, ou `null` si le groupe n'a aucun membre
     */
    private function resolveGroupOwner($group)
    {
        $table = config('socializer.signaling.relation.group_user_table', 'group_user');

        $userId = DB::table($table)
            ->where('group_id', $group->id)
            ->orderByDesc('is_leader')
            ->orderBy('id')
            ->value('user_id');

        if (!$userId) {
            return null;
        }

        return config('estarter.models.user')::find($userId);
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

    /**
     * Les groupes : leur sommet, leur rattachement à leur parent, leur créateur.
     *
     * ⚠️ CETTE ÉTAPE NE POSAIT QUE L'ARÊTE PARENT, et personne ne l'avait vu : le sommet `group`
     * lui-même n'était créé QUE par le chemin événementiel (`Users::createGroup`). Sur une base
     * projetée, `owned_by` et `registered_in` visaient donc un sommet sans tag — invisible d'un
     * `MATCH (g:group)`, donc `isServerOwner` faux pour tout le monde. Déléguer à `createGroup`
     * corrige ça et supprime au passage la double pose de l'arête parent, que `createGroup` fait
     * déjà.
     *
     * Le sommet porte un id dérivé, donc aucun verrou de relecture n'est nécessaire ici : le
     * reposer rafraîchit ses propriétés.
     */
    private function projectGroups(callable $tenter): void
    {
        $model = config('estarter.models.group');

        if(!$model) {
            return;
        }

        $usersService = new UsersService();

        foreach($model::all() as $group) {
            $tenter(
                fn () => $usersService->createGroup($group, $this->resolveGroupOwner($group)),
                "groupe {$group->id}"
            );
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
