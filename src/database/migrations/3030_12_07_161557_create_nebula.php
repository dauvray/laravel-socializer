<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Log;
use Dauvray\Socializer\app\Services\GraphProjection;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        $nebula = app('nebulaGraph');

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

        // ── À partir d'ici, du DML, et il n'est plus ici ──────────────────────────────────
        //
        // Le DDL ci-dessus, lui, ne lève pas — décision assumée : le schéma NebulaGraph est
        // asynchrone (d'où les `sleep()`), une erreur transitoire y est normale, et les
        // `IF NOT EXISTS` rendent les relances idempotentes. Il journalise, sans plus.
        //
        // Le peuplement, en revanche, vit dans `Services\GraphProjection` : `nebula-populate` le
        // rejoue à la demande, et en tenir une copie ici les faisait dériver. Cette migration ne
        // garde que sa POLITIQUE D'ERREUR — journaliser chaque refus, puis lever pour n'être pas
        // enregistrée — et l'étape des serveurs de groupes, la seule qui exige un utilisateur
        // authentifié (cf. `GraphProjection::projectGroupServers`).
        //
        // Une relance est désormais SANS DANGER : la projection est idempotente, un second passage
        // relit le réseau existant au lieu d'en créer un second (`createUserAndNetwork`).
        $projection = new GraphProjection();

        $journaliser = fn (string $quoi, array $contexte) => Log::error(
            "create_nebula : $quoi non projeté",
            $contexte
        );

        $echecs = $projection->projectGroupServers($journaliser)
            + $projection->projectAll($journaliser);

        if($echecs > 0) {
            throw new RuntimeException(
                "create_nebula : $echecs écriture(s) refusée(s) par le graphe. Le space est "
                ."partiellement peuplé — la projection étant idempotente, la reprise est une "
                ."simple relance de `migrate` une fois la cause corrigée. Détail dans le journal."
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
