<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;
use Dauvray\Socializer\app\Http\Resources\UserCollection;
use Illuminate\Support\Facades\Cache;

class Users
{

    public $nebula = null;
    public $user = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->user = Auth::user();
    }

    public function getGraphUser($user)
    {
        $me = Auth::user();

        $is_me = $me->vertexid === $user->vertexid;

        $query = "
            MATCH (u:user {active: 1}) where id(u) == '$user->vertexid' 
            OPTIONAL MATCH (u)<-[:owned_by]-(:wall)-[nbf:followed_by]->(:user)
            ";

        if(!$is_me) {
            $query .= "
            MATCH (current_user:user) where id(current_user) == '$me->vertexid'
            OPTIONAL MATCH (u)-[f:followed_by]-(current_user)
            ";
        }

        $query .= "
            RETURN u AS user, COUNT(nbf) as nb_followers
            ";

        if(!$is_me) {
            $query .= "
            , CASE WHEN f IS NULL THEN NULL ELSE 'followed' END AS follow_status
            ";
        }

        $user = app('nebulaGraph')->execute($query);

        // format
        $user[0]['user']['nb_followers'] = $user[0]['nb_followers'];

        if(!$is_me) {
            $user[0]['user']['follow_status'] = $user[0]['follow_status'];
        }

        return $user[0]['user'];
    }

    public function getUsersList($route_name = '')
    {
        $formated = [];
        
        $results = app('nebulaGraph')->execute("
            MATCH (u:user {active: 1}) 
            MATCH (current_user:user) where id(current_user) == '".$this->user->vertexid."'
            OPTIONAL MATCH (u)<-[:owned_by]-(:wall)-[f:followed_by]->(current_user) 
            OPTIONAL MATCH (u)<-[:owned_by]-(:wall)-[nbf:followed_by]->(:user)
            RETURN u AS user, CASE WHEN f IS NULL THEN NULL ELSE 'followed' END AS follow_status, COUNT(nbf) as nb_followers 
        ");

        foreach( $results as $res) {
            $user = $res['user'];
            $user_id = $user['id'];
            $user['id'] = null;
            $user['connected'] = Cache::has('user-is-online-' . str_replace('user','',$user_id)) ? 1 : 0;
            $user['follow_status'] = $res['follow_status'];
            $user['nb_followers'] = $res['nb_followers'];
            $formated[] = (object)$user;
        }

        $paginator = makePaginationCollection(collect($formated), route($route_name));

        return new UserCollection($paginator);
    }

    public function followUser($user_tofollow)
    {
        $wall_id = $user_tofollow->wall();

        $result = $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.followed_by.name'), 
            [
                $wall_id.'->'.$this->user->vertexid => config('socializer.nebulagraph.edges.followed_by.props')
            ]
        );
        
        if (count($result) === 0) {
            return true;
       }

       return false;
    }

    public function unfollowUser($user_followed)
    {
       $wall_id = $user_followed->wall();

        $result = $this->nebula->deleteEdge(
            config('socializer.nebulagraph.edges.followed_by.name'),
             [
                $wall_id.'->'.$this->user->vertexid
            ]
        );

        if (count($result) === 0) {
            return true;
       }

       return false;
    }
}