<?php

namespace Dauvray\Socializer\app\Console\Commands;

use Dauvray\Estarter\app\Console\Commands\EstarterPrepare;


class NebulaGraphClearSessions extends EstarterPrepare
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'socializer:nebula-clear-sessions {--timeout=300} : How many seconds to allow each process to run.';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Supprime les sessions NebulaGraph ( 300 max )';

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
                \/  cleaner   \/        \/              \/    \/
        ');

        try {

            $resp = app('nebulaGraph')->execute('SHOW SESSIONS');

            foreach($resp as $row) {
                app('nebulaGraph')->logout($row['SessionId']);
            }

        } catch (\Exception $e) {
            echo 'Exception reçue : ', $e->getMessage(), "\n";
        }

    }
}
