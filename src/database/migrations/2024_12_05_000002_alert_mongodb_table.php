<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Schema;
use MongoDB\Laravel\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    protected $connection = 'mongodb';

    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('alerts', function (Blueprint $collection) {
            $collection->string('hash', 255);
            $collection->bigInteger('questionnaire_id'); 
            $collection->bigInteger('user_id');
            $collection->json('search');

            // Ajout des index
            $collection->index('hash');
            $collection->index('questionnaire_id');
            $collection->index('user_id');
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::drop('alerts');
    }
};