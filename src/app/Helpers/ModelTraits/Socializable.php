<?php

namespace Dauvray\Socializer\app\Helpers\ModelTraits;

use Cviebrock\EloquentSluggable\Sluggable;
use Cviebrock\EloquentSluggable\SluggableScopeHelpers;
use Dauvray\Socializer\app\Notifications\CommentReplyOf;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Dauvray\Socializer\app\Models\Post;

trait Socializable
{
    use Sluggable, SluggableScopeHelpers;


    public function initializeSocializable()
    {
        $this->fillable = array_merge($this->fillable, ['is_bot']);
    }

    /*
    |--------------------------------------------------------------------------
    | GLOBAL VARIABLES
    |--------------------------------------------------------------------------
    */



    /**
     * Return the sluggable configuration array for this model.
     *
     * @return array
     */
    public function sluggable(): array
    {
        return [
            'slug' => [
                'source' => 'name',
            ],
        ];
    }

    public function setCoverImage($value = null)
    {

        $extras = $this->extras;

        if(!isset($extras['cover'])) {
            $extras['cover'] = null;
        }

        $isReset = $this->resethumnbnail($value, $extras['cover'], $this->disk);

        // clear image ?
        if ($isReset) {
            // set null in the database column
            $extras['cover'] = null;
        }

        $isSame = $this->isSameImage($value, $extras['cover']);

        // no modification
        if($isSame) {
            return;
        }

        $this->setThumbnails($value,$extras['cover'], $this->disk);

        $extras['cover'] = $this->setThumbnails($value, $this->image, $this->disk);

        $this->extras = $extras;

    }

    /*
    |--------------------------------------------------------------------------
    | NOTIFICATIONS && VARIABLES
    |--------------------------------------------------------------------------
    */

    public function sendCommentReplyOfNotification($token)
    {
        $this->notify(new CommentReplyOf($token));
    }

    /*
    |--------------------------------------------------------------------------
    | FUNCTIONS
    |--------------------------------------------------------------------------
    */

    // permissions

    public function canJoinchatRoom($vertex_id)
    {
       $result = app('nebulaGraph')->execute("
            OPTIONAL MATCH (c:chat)<-[:registered_in]-(u:user) 
            WHERE id(c) == '$vertex_id' AND (c.chat.privacy == 0 OR (c.chat.privacy == 1 AND id(u) == '$this->vertexid')) 
            RETURN id(u)
        ");

        if($result) {
            return true;
        }

        return false;
    }

    public function canJoinServer($vertex_id)
    {
       $result = app('nebulaGraph')->execute("
            MATCH (s:server)<-[:registered_in]-(u:user) 
            WHERE id(s) == '$vertex_id' AND (s.server.privacy == 0 OR (s.server.privacy == 1 AND id(u) == '$this->vertexid')) 
            RETURN id(u)
        ");

        if($result) {
            return true;
        }

        return false;
    }

    public function canJoinRoom($vertex_id)
    {
       $result = app('nebulaGraph')->execute("
            MATCH (r:room)<-[:registered_in]-(u:user) 
            WHERE id(r) == '$vertex_id' AND (r.room.privacy == 0 OR (r.room.privacy == 1 AND id(u) == '$this->vertexid')) 
            RETURN id(u)
        ");

        if($result) {
            return true;
        }

        return false;
    }

    public function isCreator($vertex_id)
    {
        $result = app('nebulaGraph')->execute("MATCH (s)-[:has_creator]->(u:user) WHERE id(s) == '$vertex_id' RETURN id(u)");
        return $this->_checkIsOwner($result); 
    }

    public function isServerOwner($server_id)
    {
        $result = app('nebulaGraph')->execute("MATCH (s:server)-[:has_creator]->(u:user) WHERE id(s) == '$server_id' RETURN id(u)");
        return $this->_checkIsOwner($result); 
    }

    public function isWallOwner($vertex_id)
    {
        $result = app('nebulaGraph')->execute("MATCH (w:wall)-[:owned_by]->(u:user) WHERE id(w) == '$vertex_id' RETURN id(u)");
        return $this->_checkIsOwner($result); 
    }

    public function isFeedOwner($vertex_id)
    {
        $result = app('nebulaGraph')->execute("MATCH (f:feed)-[:owned_by]->(u:user) WHERE id(f) == '$vertex_id' RETURN id(u)");
        return $this->_checkIsOwner($result); 
    }

    public function isRoomOwner($vertex_id)
    {
        $result = app('nebulaGraph')->execute("MATCH (r:room)-[:has_creator]->(u:user) WHERE id(r) == '$vertex_id' RETURN id(u)");
        return $this->_checkIsOwner($result); 
    }

    private function _checkIsOwner($result)
    {
        if(count($result)) {
            $owner_id = $result[0];

            if($owner_id != $this->vertexid) {
                return false;
            }

            return true;
        }
      
        return false;
    }

    /*
    |--------------------------------------------------------------------------
    | RELATIONS
    |--------------------------------------------------------------------------
    */

    public function posts(): MorphMany
    {
        return $this->morphMany(Post::class, 'model_type', 'model_id');
    }

    public function wall()
    {
        $wall = app('nebulaGraph')->execute("
            MATCH (w:wall)-[:owned_by]->(u:user) 
            WHERE id(u) == '$this->vertexid' 
            RETURN id(w)
        ");

        return $wall[0];
    }

    public function feed()
    {
        $feed = app('nebulaGraph')->execute("
            MATCH (f:feed)-[:owned_by]->(u:user) 
            WHERE id(u) == '$this->vertexid' 
            RETURN id(f)
        ");

        return $feed[0];
    }

    public function conversations($type = 'contacts')
    {
        $is_bot = $type == 'contacts' ? 0 : 1;
        
        $conversations = app('nebulaGraph')->execute("
            MATCH (u:user)-[:registered_in]->(c:chat)
            WHERE id(u) == '$this->vertexid' AND c.chat.is_bot == $is_bot
            OPTIONAL MATCH (c)-[:published_in]->(v)
            WITH c, collect(v) AS other_targets, c.chat.created_at AS created_at 
            WHERE size(other_targets) == 0
            WITH c, other_targets, created_at
            ORDER BY created_at DESC 
            RETURN c
        ");

        return $conversations;
    }

    public function servers()
    {
        $servers = app('nebulaGraph')->execute("
            MATCH (s:server)<-[:registered_in]-(u:user) WHERE id(u)=='$this->vertexid' RETURN s
        ");

        return $servers;
    }

    
    public function ownedServers()
    {
        $servers = app('nebulaGraph')->execute("
            MATCH (s:server)-[:has_creator]-(u:user) WHERE id(u)=='$this->vertexid' RETURN s
        ");

        return $servers;
    }

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

    /**
     * Nebulagraph vertex ID
     */
    public function getVertexIdAttribute()
    {
        return getVertexId($this);
    }

    /*
    |--------------------------------------------------------------------------
    | MUTATORS
    |--------------------------------------------------------------------------
    */


}