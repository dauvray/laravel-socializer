<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::table('notification_templates', function (Blueprint $table) {
            if (!Schema::hasColumn('notification_templates', 'section_id')) {
                $table->integer('section_id')->unsigned()->nullable();
            }
            if (!Schema::hasColumn('notification_templates', 'category_id')) {
                $table->integer('category_id')->unsigned()->nullable();
            }
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::table('notification_templates', function($table)
        {
            $table->dropColumn('section_id');
            $table->dropColumn('category_id');
        });
    }
};
