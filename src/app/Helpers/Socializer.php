<?php

use Dauvray\Socializer\app\Helpers\ContentFormater;
use Illuminate\Support\Facades\Auth;
use Dauvray\Socializer\app\Http\Resources\User as UserResource;
use \Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\Broadcast;

if (!function_exists('formatTextToContent')) {
    function formatTextToContent($text) {
        $helper = new ContentFormater($text);
        $content = str_replace(["\r\n", "\r", "\n"], "", $helper->getContent());
        return [
            'src' => $text,
            'content' => $content,
            'hashtags' => $helper->getHashtags(),
            'mentions' => $helper->getMentions(),
            'thumbnails' => $helper->getThumbnails(),
        ];
    }
}

if (!function_exists('filterSensibleDataUserRessource')) {
    function filterSensibleDataUserRessource($user)  {
        
        $result = collect(new UserResource($user))->toArray();

        // Remove sensitive data
        unset($result['email']);
        unset($result['created_at']);
        unset($result['roles']);
        unset($result['permissions']);
        unset($result['channel']);

        return $result;
    }
}

if (!function_exists('broadcastEventbusNotification')) {
    function broadcastEventbusNotification($user_id, $payload = []) {
        try {
            Broadcast::private('App.Models.User.'.$user_id)
            ->as('EventBusNotification')
            ->with([
                'type' => 'prompt_request_completed',
                'payload' => $payload,
            ])
            ->sendNow();
        }
            catch (\Exception $ex) {
            return $ex;
        }
    }
}


/*---------------------------
| NEBULAGRAPH
|----------------------------*/

if (!function_exists('makeNebulaPagination')) {
    function makeNebulaPagination(
        string $matchQuery,    // ton MATCH ... WHERE ...
        string $returnClause,  // ton RETURN ...
        string $orderBy = '',  // ORDER BY ...
        string $path = '',
        int $defaultPage = 1,
        ?int $perPage = null
    ) {
        $page    = request('page', $defaultPage);
        $perPage = $perPage ?? config('settings.items_by_pages');

        // 1️⃣ Query pour compter le total
        $countQuery = "
            $matchQuery
            RETURN count(*) AS total
        ";

        $totalResult = app('nebulaGraph')->execute($countQuery);

        // 2️⃣ Query paginée
        $pagedQuery = "
            $matchQuery
            $returnClause
            " . ($orderBy ? "ORDER BY $orderBy" : "") . "
            LIMIT $perPage
        ";

        $pagedResult = app('nebulaGraph')->execute($pagedQuery);
        $results = collect($pagedResult);

        // 3️⃣ Retour paginator
        return new LengthAwarePaginator(
            $results,
            $totalResult[0],
            $perPage,
            $page,
            ['path' => $path]
        );
    }
}

if (!function_exists('getVertexId')) {
    function getVertexId($item)
    {
        $exists = property_exists((object)$item->getAttributes(), 'vertexid');
        if($exists) {
            return $item->getAttributes()['vertexid'];
        }

        $class_name = getClassNameFromNamespace($item);
        return config('socializer.nebulagraph.tags.'. strtolower($class_name) .'.name') . $item->id;
    }
}

if (!function_exists('getNextPositionItem')) {
    function getNextPublishedPosition($vertex_id)
    {
        if(!$vertex_id) {
            return 0;
        }
        $result = app('nebulaGraph')->execute("MATCH (s)<-[:published_in]-(r) WHERE id(s) == '$vertex_id' RETURN COUNT(r)");
        return $result[0];
    }
}

if (!function_exists('getVertexIdFromInsert')) {
    function getVertexIdFromInsert($result)
    {
        $item = explode(':', $result[0]);
        return str_replace('"', '', $item[0]);
    }
}

if (!function_exists('getRealIdFromVertexId')) {
    function getRealIdFromVertexId($vertex_id, $tag ='user')
    {
        $tag = config('socializer.nebulagraph.tags.' . $tag . '.name');
        if(strpos($vertex_id, $tag) === 0) {
            return str_replace($tag, '', $vertex_id);
        }

        return null;
    }
}

if (!function_exists('getFeedFollowers')) {
    function getFeedFollowers($feedVertexId, $except_me = false) {
        if(!$except_me) {
            $followers = app('nebulaGraph')->execute("
                MATCH (feed_dest:feed)-[:owned_by]->(u:user)<-[:followed_by]-(w:wall) 
                WHERE id(w) == '$feedVertexId' 
                RETURN feed_dest, u as user
            ");
        } else {
            $user = Auth::user();
            $followers = app('nebulaGraph')->execute("
                MATCH (feed_dest:feed)-[:owned_by]->(u:user)<-[:followed_by]-(w:wall) 
                WHERE id(w) == '$feedVertexId' AND id(u) != '$user->vertexid'
                RETURN feed_dest, u as user
            ");
        }

        return $followers;
    }
}

if (!function_exists('createUserAndNetwork')) {
    function createUserAndNetwork($user) {
        $nebula = app('nebulaGraph');

        /*
        | VERTEX
        */

        $nebula->insertVertex(
            config('socializer.nebulagraph.tags.user.name'), 
            array_merge(
                $nebula->populatePropsFromPattern(
                    $user, 
                    config('socializer.nebulagraph.vertices.user')
                ),
                [
                    'identifier' => hideIdentifier($user)
                ]
            )
        );

        $result = $nebula->insertVertex(
            config('socializer.nebulagraph.tags.feed.name'),
            []
        );

        $result2 = $nebula->insertVertex(
            config('socializer.nebulagraph.tags.wall.name'),
                [
                    'questionnaire_id' => config('socializer.posts.classic_form'),
                ]
        );

        /*
        | RELATIONSHIP
        */

        $feedVertexId = getVertexIdFromInsert($result);
        $wallVertexId = getVertexIdFromInsert($result2);
        $userVertexId = $user->vertexid;

        // create user feed
        $nebula->insertEdge(
            config('socializer.nebulagraph.edges.owned_by.name'), 
            [
                $feedVertexId.'->'.$userVertexId => config('socializer.nebulagraph.edges.owned_by.props')
            ]
        );

        // create user wall
        $nebula->insertEdge(
            config('socializer.nebulagraph.edges.owned_by.name'), 
            [
                $wallVertexId.'->'.$userVertexId => config('socializer.nebulagraph.edges.owned_by.props')
            ]
        );

        // user follow his wall
        $nebula->insertEdge(
            config('socializer.nebulagraph.edges.followed_by.name'), 
            [
            $wallVertexId.'->'.$userVertexId => config('socializer.nebulagraph.edges.followed_by.props')
            ]
        );
    }
}

// SERVER HELPERS
if (!function_exists('checkServerAccess')) {
    function checkServerAccess($vertex_id, $user_vertexid, $tag='server') {
        $nebula = app('nebulaGraph');
        $query = "
            MATCH (o:user)<-[:has_creator]-(s:".$tag.")<-[:registered_in]-(u:user) 
            WHERE id(s) == '$vertex_id' AND (s.".$tag.".privacy == 0 OR (s.".$tag.".privacy == 1 AND id(u) == '$user_vertexid') OR (s.".$tag.".privacy == 2 AND id(o) == '$user_vertexid')) 
            RETURN id(s) as server_id
        ";
        $result = $nebula->execute($query);
        return isset($result[0]);
    }
}

if (!function_exists('getServerAdmin')) {
    function getServerAdmin($server_vertexid)
    {
        $nebula = app('nebulaGraph');
        $query = "
            MATCH (o:user)<-[:has_creator]-(s:server)
            WHERE id(s) == '$server_vertexid'
            RETURN id(o)
        ";
        $result = $nebula->execute($query);
        return getRealIdFromVertexId($result[0]);
    }
}

/*---------------------------
| Vertices & Edges Helpers
|----------------------------*/

if (!function_exists('setRegisteredRelation')) {
    function setRegisteredRelation($user_vid, $vid)
    {
         app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.registered_in.name'), 
            [
                $user_vid .'->'. $vid => config('socializer.nebulagraph.edges.registered_in.props')
            ]
        );
    }
}

if (!function_exists('setHasCreatorRelation')) {
    function setHasCreatorRelation($creator_vid, $vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.has_creator.name'), 
            [
                $vid .'->'. $creator_vid => config('socializer.nebulagraph.edges.has_creator.props')
            ]
        );
    }
}

if (!function_exists('setPublishedInRelation')) {
    function setPublishedInRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.published_in.name'), 
            [
                $from_vid .'->'. $to_vid => config('socializer.nebulagraph.edges.published_in.props')
            ]
        );
    }
}

if (!function_exists('setFollowedByRelation')) {
    function setFollowedByRelation($from_vid, $to_vid)
    {
        return app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.followed_by.name'), 
            [
                $from_vid .'->'. $to_vid => config('socializer.nebulagraph.edges.followed_by.props')
            ]
        );
    }
}

if (!function_exists('setOwnedByRelation')) {
    function setOwnedByRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.owned_by.name'), 
            [
                $from_vid .'->'. $to_vid => config('socializer.nebulagraph.edges.owned_by.props')
            ]
        );
    }
}

if (!function_exists('setReplyOfRelation')) {
    function setReplyOfRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.reply_of.name'), 
            [
                $from_vid.'->'.$to_vid => config('socializer.nebulagraph.edges.reply_of.props')
            ]
        );
    }
}

if (!function_exists('setSharingOfRelation')) {
    function setSharingOfRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.sharing_of.name'), 
            [
                $from_vid.'->'.$to_vid => config('socializer.nebulagraph.edges.sharing_of.props')
            ]
        );
    }
}

if (!function_exists('setSharedByRelation')) {
    function setSharedByRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
             config('socializer.nebulagraph.edges.shared_by.name'), 
            [
                $from_vid.'->'.$to_vid => config('socializer.nebulagraph.edges.shared_by.props')
            ]
        );
    }
}

if (!function_exists('setSharedInRelation')) {
    function setSharedInRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.shared_in.name'), 
            [
                $from_vid.'->'.$to_vid => config('socializer.nebulagraph.edges.shared_in.props')
            ]
        );
    }
}