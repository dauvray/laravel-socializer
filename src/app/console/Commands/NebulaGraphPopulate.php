<?php

namespace Dauvray\Socializer\app\Console\Commands;

use Dauvray\Estarter\app\Console\Commands\EstarterPrepare;
use Dauvray\Socializer\app\Services\GraphProjection;


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

        // Le peuplement lui-même vit dans `Services\GraphProjection`, partagé avec la migration
        // `create_nebula` : en tenir une copie ici les faisait dériver — cette commande avait perdu
        // le `marketplace` et les parents de groupes en route. Ne reste ici que la POLITIQUE
        // D'ERREUR de la commande : rapporter chaque refus sur la sortie, et le décompte final qui
        // décide du code de sortie.
        //
        // Le `try` unique qui enveloppait tout abandonnait la boucle au premier échec, et sortait
        // en code 0 : le peuplement s'arrêtait à mi-chemin en annonçant « terminé ». Depuis E7 les
        // écritures lèvent, ce qui rend le défaut à la fois plus probable et enfin visible. Le
        // rattrapage est donc PAR ITEM, dans la projection.
        //
        // ⚠️ Les serveurs de groupes ne sont PAS projetés ici : cette étape exige un utilisateur
        // authentifié, cf. `GraphProjection::projectGroupServers`.
        try {
            // Le libellé reste pauvre à dessein : le message brut du graphe cite du contenu
            // utilisateur (cf. règle 1 de `NebulaGraphException`), il sort par le journal.
            $echecs = (new GraphProjection())->projectAll(
                fn (string $quoi, array $contexte) => $this->error(
                    "Non projeté — $quoi : {$contexte['operation']} refusé par NebulaGraph (code {$contexte['code']})."
                )
            );
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
