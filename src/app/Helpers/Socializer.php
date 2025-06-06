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
            'mentions' => $helper->getMentions()
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

if (!function_exists('getFeedFollowers')) {
    function getFeedFollowers($feedVertexId, $except_me = false) {
        if(!$except_me) {

            $followers = app('nebulaGraph')->execute("
                MATCH (feed_dest:feed)-[:owned_by]->(:user)<-[:followed_by]-(w:wall) 
                WHERE id(w) == '$feedVertexId' 
                RETURN feed_dest
            ");

        } else {
            $user = Auth::user();
            $followers = app('nebulaGraph')->execute("
                MATCH (feed_dest:feed)-[:owned_by]->(u:user)<-[:followed_by]-(w:wall) 
                WHERE id(w) == '$feedVertexId' AND id(u) != '$user->vertexid'
                RETURN feed_dest
            ");
        }

        return $followers;
       
    }
}

