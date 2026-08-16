<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Dauvray\Socializer\app\Http\Resources\UserCollection;

class Users
{
    public $nebula = null;
    public $user = null;
    public $onlineService = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->user = Auth::user();
        $this->onlineService = app('onlineUsers');
    }

    public function getGraphUser($user)
    {
        $me = Auth::user();

        $is_me = $me->vertexid === $user->vertexid;

        // Verdict de la règle de relation (C2), calculé AVANT que `$user` ne soit écrasé plus
        // bas par la réponse du graphe. C'est le prédicat que les 5 routes de signalisation
        // appliquent déjà : le profil ne fait que le rendre visible, pour que le bouton
        // d'appel cesse de proposer un appel qui partira en 403.
        //
        // ⚠️ UX seulement — le serveur reste l'autorité. Masquer le bouton n'est PAS un
        // contrôle : la route refuse de toute façon.
        $may_reach = $me->mayReach($user);

        // recupere le user et le nombre de followers
        $query = "
            MATCH (u:user {active: 1}) where id(u) == '$user->vertexid' 
            OPTIONAL MATCH (u)<-[:owned_by]-(w:wall)-[nbf:followed_by]->(:user)
            ";

        // si ce n'est pas moi, on verifie si je le suis
        if(!$is_me) {
            $query .= "
            MATCH (current_user:user) where id(current_user) == '$me->vertexid'
            OPTIONAL MATCH (w)-[f:followed_by]->(current_user)
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
        $user[0]['user']['may_reach'] = $may_reach;

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
            $user['id'] = getRealIdFromVertexId($user['id']);
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

        $result = setFollowedByRelation($wall_id, $this->user->vertexid);

        $this->forgetRelationVerdict($user_tofollow);

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

        $this->forgetRelationVerdict($user_followed);

        if (count($result) === 0) {
            return true;
       }

       return false;
    }

    /**
     * Oublie le verdict mémorisé par `Socializable::mayReach` pour cette paire.
     *
     * Un follow qui ne l'invaliderait pas ne débloquerait l'appel qu'au bout du TTL. C'est
     * le sens qui compte : une AUTORISATION périmée n'est qu'une fenêtre bornée, un REFUS
     * périmé est un bouton qui échoue juste après qu'on s'est abonné.
     */
    private function forgetRelationVerdict($other): void
    {
        Cache::forget(
            config('estarter.models.user')::relationCacheKey($this->user->getKey(), $other->getKey())
        );
    }

    public function createGroup($group) 
    {
        $group_id = getVertexId($group);

        $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.group.name'), 
            array_merge(
                $this->nebula->populatePropsFromPattern(
                    $group, 
                    config('socializer.nebulagraph.vertices.group')
                ),
                [
                    'identifier' => hideIdentifier($group),
                    'id' => $group_id
                ]
            )
        );

        // groupe / parent groupe relation
        setGroupHasParentRelation($group);

        // groupe / creator relation
        setHasCreatorRelation($group_id, $this->user->vertexid);

        return $group_id;
    }

    public function deleteGroup($group) {
        return app('nebulaGraph')->deleteVertex([getVertexId($group)], true);
    }
}