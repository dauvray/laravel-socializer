<?php

namespace Dauvray\Socializer\app\Console\Commands;

use Dauvray\Estarter\app\Console\Commands\EstarterPrepare;


use Illuminate\Support\Facades\Hash;
use Spatie\Permission\Models\Role;
use App\Models\User; // Assuming the User model is in App\Models namespace

class SocializerUpgrade extends EstarterPrepare
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'socializer:upgrade {--timeout=300} : How many seconds to allow each process to run.';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Mise à jour du package laravel-socializer';

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
                \/  Upgrader  \/        \/              \/    \/
        ');

        try {
            // create bot role
          //  Role::create(['name' => 'Agent AI']);

            // create bot user
            $chatbot = User::create([
                "name" => "ChatBot",
                "email_verified_at" => "2018-07-11 16:19:10",
                "email" => "chatbot@estarter.com",
                "password" => Hash::make('adminpass'),
                "extras" => [
                    "private" => "1",
                    "function" => ""
                    ],
                "active" => "1",
                "is_bot" => "1",
            ]);

            $chatbot->assignRole('Agent AI');



            /*---------------------------------------*/
            // for ever
            // add scss in app
            // $this->executeProcess(['cp', '-f',
            //     base_path('vendor/'.config('estarter.vendor_domain').'/laravel-socializer/src/resources/sass/_socializer.scss'),
            //     base_path('resources/sass/_socializer.scs')
            // ]);
            /*------------------------------------------*/

        } catch (\Exception $e) {
            echo 'Exception reçue : ', $e->getMessage(), "\n";
        }

    }
}
