<?php

namespace Dauvray\Socializer\app\Console\Commands;

use Dauvray\Estarter\app\Console\Commands\EstarterPrepare;


class NebulaGraphPopulate extends EstarterPrepare
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'socializer:nebula-populate {--timeout=300} : How many seconds to allow each process to run.';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Rempli la base de données NebulaGraph';

    /**
     * Create a new command instance.
     *
     * @return void
     */
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Execute the console command.
     *
     * @return mixed
     */
    public function handle()
    {
        $this->info('
          _________             .__       .__  .__
         /   _____/ ____   ____ |__|____  |  | |__|_______ ___________
         \_____  \ /  _ \_/ ___\|  \__  \ |  | |  \___   // __ \_  __ \
         /        (  <_> )  \___|  |/ __ \|  |_|  |/    /\  ___/|  | \/
        /_______  /\____/ \___  >__(____  /____/__/_____ \\___  >__|
                \/  populate  \/        \/              \/    \/
        ');

        try {

            $nebula = app('nebulaGraph');

            /*
            | USERS
            */
            foreach(config('estarter.models.user')::all() as $user) {
                createUserAndNetwork($user);
            }

            /*
            | ARTICLES
            */

            foreach(config('eblogger.models.article')::all() as $article) {
                $nebula->insertVertex(
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
                );
            }

            foreach(config('eblogger.models.article')::all() as $article) {
                // relie article et auteur
                // Defini le sens de la relation et passe des parametres
                // e.g : Article2->User3 => []
                $nebula->insertEdge(
                    config('socializer.nebulagraph.edges.has_creator.name'), 
                    [
                        config('socializer.nebulagraph.tags.article.name').$article->id.'->'.config('socializer.nebulagraph.tags.user.name').$article->author->id => config('socializer.nebulagraph.edges.has_creator.props')
                    ]
                );
            }

        } catch (\Exception $e) {
            echo 'Exception reçue : ', $e->getMessage(), "\n";
        }

    }
}
