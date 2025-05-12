<?php

namespace Dauvray\Socializer\database\seeders;

// use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $this->call(SettingsTableSeeder::class);
        $this->call(QuestionnairesTableSeeder::class);
        $this->call(MenuTableSeeder::class);
    }
}
