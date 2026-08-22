<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Log;
use Dauvray\Socializer\app\Exceptions\NebulaGraphException;
use Dauvray\Socializer\app\Services\Server as ServerService;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        $nebula = app('nebulaGraph');
        $serverService = new ServerService();

        /*
        | SPACE
        */

        $nebula->createSpace(config('database.connections.nebula.space'));
        sleep(config('socializer.nebulagraph.sleeping_duration'));
        
        $nebula->useSpace(config('database.connections.nebula.space'));

        /*
        | TAGS
        */

        $nebula->createTag(config('socializer.nebulagraph.tags.user'));
        $nebula->createTag(config('socializer.nebulagraph.tags.group'));
        $nebula->createTag(config('socializer.nebulagraph.tags.comment'));
        $nebula->createTag(config('socializer.nebulagraph.tags.post'));
        $nebula->createTag(config('socializer.nebulagraph.tags.share'));
        $nebula->createTag(config('socializer.nebulagraph.tags.feed'));
        $nebula->createTag(config('socializer.nebulagraph.tags.wall'));
        $nebula->createTag(config('socializer.nebulagraph.tags.chat'));
        $nebula->createTag(config('socializer.nebulagraph.tags.message'));
        $nebula->createTag(config('socializer.nebulagraph.tags.server'));
        $nebula->createTag(config('socializer.nebulagraph.tags.room'));
        $nebula->createTag(config('socializer.nebulagraph.tags.data'));
        $nebula->createTag(config('socializer.nebulagraph.tags.page'));
        $nebula->createTag(config('socializer.nebulagraph.tags.whiteboard'));
        $nebula->createTag(config('socializer.nebulagraph.tags.classroom'));
        $nebula->createTag(config('socializer.nebulagraph.tags.article'));
        $nebula->createTag(config('socializer.nebulagraph.tags.marketplace'));
        $nebula->createTag(config('socializer.nebulagraph.tags.application'));

        /*
        | EDGE
        */
        
        $nebula->createEdge(config('socializer.nebulagraph.edges.has_creator'));
        $nebula->createEdge(config('socializer.nebulagraph.edges.reply_of'));
        $nebula->createEdge(config('socializer.nebulagraph.edges.liked_by'));
        $nebula->createEdge(config('socializer.nebulagraph.edges.disliked_by'));
        $nebula->createEdge(config('socializer.nebulagraph.edges.followed_by'));
        $nebula->createEdge(config('socializer.nebulagraph.edges.published_in'));
        $nebula->createEdge(config('socializer.nebulagraph.edges.owned_by'));
        $nebula->createEdge(config('socializer.nebulagraph.edges.shared_by'));
        $nebula->createEdge(config('socializer.nebulagraph.edges.sharing_of'));
        $nebula->createEdge(config('socializer.nebulagraph.edges.shared_in'));
        $nebula->createEdge(config('socializer.nebulagraph.edges.registered_in'));

        /*
        | INDEXES
        */

        $nebula->createTagIndex('user', 'user_index');
        $nebula->createTagIndex('group', 'group_index');
        $nebula->createTagIndex('feed', 'feed_index');
        $nebula->createTagIndex('post', 'post_index');
        $nebula->createTagIndex('server', 'server_index');
        $nebula->createTagIndex('room', 'room_index');


        sleep(config('socializer.nebulagraph.sleeping_duration'));

        // ── À partir d'ici, du DML : il LÈVE depuis E7 ────────────────────────────────────
        //
        // Le DDL ci-dessus, lui, ne lève pas — décision assumée : le schéma NebulaGraph est
        // asynchrone (d'où les `sleep()`), une erreur transitoire y est normale, et les
        // `IF NOT EXISTS` rendent les relances idempotentes. Il journalise, sans plus.
        //
        // Le DML, en revanche, est du PEUPLEMENT en boucle. Le rattraper PAR ITEM, plutôt que de
        // laisser la première exception traverser `up()`, évite de perdre les 18 tags, 11 arêtes
        // et 6 index déjà posés à cause d'un seul enregistrement bancal — typiquement
        // `$article->author->id` sur un auteur supprimé. Le décompte final fait quand même
        // échouer la migration : elle ne sera pas enregistrée, et `migrate` sortira en non-zéro.
        //
        // ⚠️ LA REPRISE N'EST PAS UNE RELANCE. `createUserAndNetwork` n'est pas idempotente —
        // `insertVertex('feed', [])` tire un `uniqidReal()` neuf à chaque passage, donc rejouer
        // `migrate` DUPLIQUERAIT les feeds et les walls. La reprise est `migrate:rollback` (qui
        // fait `dropSpace`) puis `migrate`.
        $echecs = 0;

        $peupler = function (callable $ecriture, string $quoi) use (&$echecs): void {
            try {
                $ecriture();
            } catch (NebulaGraphException $e) {
                $echecs++;
                Log::error("create_nebula : $quoi non projeté", $e->context());
            }
        };

        /*
        | GROUPS
        */
        foreach(config('estarter.models.group')::all() as $group) {
            $peupler(fn () => $serverService->createGroupServer(
                [
                    'name' => $group->name,
                    'privacy' => 1,
                ],
                getVertexId($group)
            ), "serveur du groupe {$group->id}");
        }

        foreach(config('estarter.models.group')::all() as $group) {
            $peupler(fn () => setGroupHasParentRelation($group), "parent du groupe {$group->id}");
        }

        /*
        | USERS
        */
        foreach(config('estarter.models.user')::all() as $user) {
            $peupler(fn () => createUserAndNetwork($user), "réseau de l'utilisateur {$user->id}");
        }

        /*
        | VERTEX
        */

        foreach(config('eblogger.models.article')::all() as $article) {
            $peupler(fn () => $nebula->insertVertex(
                config('socializer.nebulagraph.tags.article.name'),
                array_merge(
                    $nebula->populatePropsFromPattern(
                        $article,
                        config('socializer.nebulagraph.vertices.article')
                    ),
                    [
                        'identifier' => hideIdentifier($article)
                    ]
                )
            ), "article {$article->id}");
        }

        $peupler(fn () => $nebula->insertVertex(
            config('socializer.nebulagraph.tags.marketplace.name'),
            ['id' => 'marketplace']
        ), 'marketplace');


        sleep(config('socializer.nebulagraph.sleeping_duration'));

        /*
        | RELATIONSHIP
        */

        foreach(config('eblogger.models.article')::all() as $article) {
            // relie article et auteur
            $peupler(fn () => setHasCreatorRelation(
                config('socializer.nebulagraph.tags.article.name').$article->id,
                config('socializer.nebulagraph.tags.user.name').$article->author->id
            ), "auteur de l'article {$article->id}");
        }

        if($echecs > 0) {
            throw new RuntimeException(
                "create_nebula : $echecs écriture(s) refusée(s) par le graphe. Le space est "
                ."partiellement peuplé — reprendre par `migrate:rollback` puis `migrate`, JAMAIS "
                ."par une simple relance (`createUserAndNetwork` n'est pas idempotente). Détail "
                ."dans le journal."
            );
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        $nebula = app('nebulaGraph');

        $nebula->dropSpace(config('database.connections.nebula.space'));

        // $nebula->dropTag(config('socializer.nebulagraph.tags.comment.name'));
        // $nebula->dropTag(config('socializer.nebulagraph.tags.user.name'));

        // $users = User::all();

        // foreach($users as $user) {
        //     $nebula->deleteVertex([config('socializer.nebulagraph.tags.user.name').$user->id], true); 
        // }

        // if(config('eblogger')) {
        //     $nebula->dropTag(config('socializer.nebulagraph.tags.article.name'));
        //     $articles = config('eblogger.models.article')::all();
        //     foreach($articles as $article) {
        //         $nebula->deleteVertex([config('socializer.nebulagraph.tags.article.name').$article->id], true);
        //     }
        // }

        // $nebula->dropEdge(config('socializer.nebulagraph.edges.has_creator.name'));
    }
};
