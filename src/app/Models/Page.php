<?php

namespace Dauvray\Socializer\app\Models;

use MongoDB\Laravel\Eloquent\Model;
use Dauvray\Socializer\app\Helpers\ModelTraits\Commentable;

class Page extends Model
{
    use Commentable;
    
    /*
    |--------------------------------------------------------------------------
    | GLOBAL VARIABLES
    |--------------------------------------------------------------------------
    */

    protected $collection = 'pages';
    protected $table = 'pages';
    protected $connection = 'mongodb';

    protected $primaryKey = '_id';

    protected $fillable = [
        'model_id',
        'model_type',
        'content',
        'styles',
        'script',
        'data',
        'vertexid',
        'server_id',
        'room_id',
        'application_id',
        'created_at',
    ];


    /*
    |--------------------------------------------------------------------------
    | FUNCTIONS
    |--------------------------------------------------------------------------
    */

    /**
     * Get the attributes that should be cast.
     */
    protected function casts(): array
    {
        return [
            'data' =>'json:unicode',
        ];
    }



    /*
    |--------------------------------------------------------------------------
    | RELATIONS
    |--------------------------------------------------------------------------
    */



    /*
    |--------------------------------------------------------------------------
    | SCOPES
    |--------------------------------------------------------------------------
    */


    /*
    |--------------------------------------------------------------------------
    | ACCESORS
    |--------------------------------------------------------------------------
    */

    /*
    |--------------------------------------------------------------------------
    | MUTATORS
    |--------------------------------------------------------------------------
    */

}
