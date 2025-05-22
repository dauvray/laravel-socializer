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
        Schema::create('pages', function (Blueprint $collection) {
            $collection->string('model_type', 255);
            $collection->bigInteger('model_id');
            $collection->string('room_id', 255)->nullable();
            $collection->string('vertexid', 255);
            $collection->text('extras')->nullable();

            // Indexation (MongoDB crée des index différemment de MySQL)
            $collection->index('model_id');
            $collection->index('model_type');
            $collection->index('room_id');
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::drop('pages');
    }
};