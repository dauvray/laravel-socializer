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
        Schema::create('posts', function (Blueprint $collection) {
            $collection->bigInteger('feed_id');
            $collection->bigInteger('questionnaire_id');
            $collection->text('model')->nullable();
            $collection->bigInteger('model_id');
            $collection->string('model_type', 255);
            $collection->string('shared_by', 255)->nullable();
            $collection->string('type', 255)->nullable();
            $collection->string('vertexid', 255);

            // Indexation (MongoDB crée des index différemment de MySQL)
            $collection->index('model_id');
            $collection->index('model_type');
            $collection->index('feed_id');
            $collection->index('questionnaire_id');
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::drop('posts');
    }
};