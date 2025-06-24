<?php

use Dauvray\Socializer\app\Helpers\ContentFormater;
use Illuminate\Support\Facades\Auth;

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

/*---------------------------
| NEBULAGRAPH
|----------------------------*/

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
