<?php

namespace Dauvray\Socializer\app\Helpers\ModelTraits;


trait Commentable
{
    // public static function bootCommentable()
    // {
    //     static::created(function($item){
    //         CommentCreated::dispatch($item);
    //     });

    //     static::deleting(function ($item) {
    //         CommentDeleted::dispatch($item);
    //     });
    // }


    /*
    |--------------------------------------------------------------------------
    | FUNCTIONS
    |--------------------------------------------------------------------------
    */

    /**
     * TODO : Verifier le fonctionnement
     * @return bool
     */
    public function mustBeApprovedComment()
    {
        if(\Config::get('estarter.approve_comments')) {
            return true;
        }

        if($this->mustBeApproved) {
            return true;
        }

        return false;
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

    public function getIsCommentableAttribute()
    {
        if(!\Config::get('estarter.allow_comments')) {
            return false;
        }

        if( isset($this->extras['enable_comments']) && $this->extras['enable_comments'] == 0) {
            return false;
        }

        return true;
    }

    /**
     * Nebulagraph vertex ID
     */
    public function getVertexIdAttribute()
    {
        return getVertexId($this);
    }

    /**
     * Commentaires
     */


    public function getNbCommentsAttribute()
    {
        return collect(app('nebulaGraph')->execute('
            MATCH (v)<-[:reply_of]-(c) WHERE id(v) == "'.$this->vertexId.'" 
            RETURN count(c) as nbcomments;
        '))->first();
    }

    /*
    |--------------------------------------------------------------------------
    | MUTATORS
    |--------------------------------------------------------------------------
    */
}