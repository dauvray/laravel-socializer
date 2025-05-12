<?php

namespace Dauvray\Socializer\database\seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SettingsTableSeeder extends Seeder
{

    /**
     * Run the database seeds.
     *
     * @return void
     */
    public function run()
    {

    /**
     * The settings to add.
     */
        $settings = [
            [
                'key'         => 'allow_comments',
                'name'        => 'Autorise commentaires',
                'description' => 'Autorise l\'utilisateur a poster des commentaires',
                'value'       => '',
                'field'       => '',
                'active'      => 1,
            ],
        ];

        foreach ($settings as $index => $setting) {
            $result = DB::table('settings')->insert($setting);

            if (!$result) {
                $this->command->info("Insert failed at record $index.");

                return;
            }
        }

        $this->command->info('Inserted '.count($settings).' records.');
    }
}
