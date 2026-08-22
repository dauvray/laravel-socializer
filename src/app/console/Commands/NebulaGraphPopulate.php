<?php

namespace Dauvray\Socializer\app\Console\Commands;

use Dauvray\Estarter\app\Console\Commands\EstarterPrepare;
use Dauvray\Socializer\app\Exceptions\NebulaGraphException;


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

        // Le rattrapage est PAR ITEM, et le décompte final décide du code de sortie.
        //
        // Le `try` unique qui enveloppait tout abandonnait la boucle au premier échec, et sortait
        // en code 0 : le peuplement s'arrêtait à mi-chemin en annonçant « terminé ». Depuis E7
        // les écritures lèvent, ce qui rend le défaut à la fois plus probable et enfin visible.
        $echecs = 0;

        try {
            $nebula = app('nebulaGraph');

            /*
            | USERS
            */
            foreach(config('estarter.models.user')::all() as $user) {
                try {
                    createUserAndNetwork($user);
                } catch (NebulaGraphException $e) {
                    $echecs++;
                    $this->error("Utilisateur {$user->id} non projeté : ".$e->getMessage());
                }
            }

            /*
            | ARTICLES
            */

            foreach(config('eblogger.models.article')::all() as $article) {
                try {
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
                } catch (NebulaGraphException $e) {
                    $echecs++;
                    $this->error("Article {$article->id} non projeté : ".$e->getMessage());
                }
            }

            foreach(config('eblogger.models.article')::all() as $article) {
                try {
                    // relie article et auteur
                    // Defini le sens de la relation et passe des parametres
                    // e.g : Article2->User3 => []
                    $nebula->insertEdge(
                        config('socializer.nebulagraph.edges.has_creator.name'),
                        [
                            config('socializer.nebulagraph.tags.article.name').$article->id.'->'.config('socializer.nebulagraph.tags.user.name').$article->author->id => config('socializer.nebulagraph.edges.has_creator.props')
                        ]
                    );
                } catch (NebulaGraphException $e) {
                    $echecs++;
                    $this->error("Auteur de l'article {$article->id} non relié : ".$e->getMessage());
                }
            }

        } catch (\Throwable $e) {
            // Le transport mort, ou un défaut hors NebulaGraph : rien à poursuivre.
            $this->error('Exception reçue : '.$e->getMessage());

            return self::FAILURE;
        }

        if($echecs > 0) {
            $this->error("$echecs écriture(s) refusée(s) par le graphe : le peuplement est INCOMPLET.");

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
