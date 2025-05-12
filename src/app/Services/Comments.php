<?php

namespace Dauvray\Socializer\app\Services;

use Dauvray\Socializer\app\Events\CommentCreated;
use Dauvray\Socializer\app\Events\CommentDeleted;
use Dauvray\Socializer\app\Events\CommentCalculated;
use Illuminate\Support\Facades\Auth;
use Dauvray\Socializer\app\Http\Resources\CommentCollection;

class Comments
{
    public $nebula = null;
    public $user = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->user = Auth::user();
    }

    /*
    | COMMENTS
    */

    public function loadComments($vertex_id, $tag, $route_name, $order='createdAT DESC')
    {
        // my comments
        if($order == 'mine') {
            $subQuery = 'MATCH (c:'. $tag .')<-[b:reply_of]-(a:comment)-[h:has_creator]->(u:user) 
            WHERE id(u) =="'.Auth::user()->vertexId.'" AND id(c) == "'. $vertex_id .'"';

            $order = 'createdAT DESC';

        } else {
        // all comments
        $subQuery = ' MATCH (a:comment)-[b:reply_of]->(c:'. $tag .') WHERE id(c) =="'. $vertex_id .'" 
                    OPTIONAL MATCH (a)-[h:has_creator]->(u:user)';
        }

        $comments = collect(app('nebulaGraph')->execute( 
            $subQuery .'
            OPTIONAL MATCH (l:comment)-[m:reply_of]->(a)
            OPTIONAL MATCH (a)-[z:liked_by]->(:user)
            OPTIONAL MATCH (a)-[x:disliked_by]->(:user)
            OPTIONAL MATCH (c)-[ff:reply_of]->(p)
            RETURN a as comment, a.comment.created_at as createdAT, u as author, count(DISTINCT l) as count, count(DISTINCT z) as likes, count(DISTINCT x) as dislikes, id(c) as parent, id(p) as store
            ORDER BY '. $order .';
        '));

        $paginator = makePaginationCollection($comments, route($route_name));

        return new CommentCollection($paginator);
    }

    public function createCommment($comment, $vertexid)
    {
        $author = $this->user;
        $formated = formatTextToContent($comment);
        $comment = $formated['content'];

        /**
         * Comment to NEBULA
         */

        $res = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.comment.name'), 
            $this->nebula->populatePropsFromPattern(
            (object)[
                    'content' => $comment,
                ], 
                config('socializer.nebulagraph.vertices.comment')
            )
        );

        if(!is_array($res)) {
            return response()->json($res, 500);
        }  
        
        /*
            Comments are only saved in nebulagraph.
            so we have to get the inserted ids to create relations
        */

        foreach($res as $new_comment) {
            if (preg_match('/"([a-z0-9]+)":/', $new_comment, $matches)) {
                $comment_id = $matches[1];
                
                // comment / article relation
                $this->nebula->insertEdge(
                    config('socializer.nebulagraph.edges.reply_of.name'), 
                    [
                        $comment_id.'->'.$vertexid => config('socializer.nebulagraph.edges.reply_of.props')
                    ]
                );
                // comment / author relation    
                $this->nebula->insertEdge(
                    config('socializer.nebulagraph.edges.has_creator.name'), 
                    [
                        $comment_id.'->'.$author->vertexId => config('socializer.nebulagraph.edges.has_creator.props')
                    ]
                );
            }
        } 

        // get ancestors
        $result = $this->nebula->execute('MATCH (c:comment)-[:reply_of]->(a)-[:reply_of]->(b) WHERE id(c) =="'. $comment_id .'"  return id(a) as parentId, id(b) as storeId');

        /**
         * Comment to broadcast to others
         */

         $resource = [
            'comment' => [
                'content' => html_entity_decode($comment),
                'created_at' => date('c'),
                'id' => $comment_id,
                'type' => "vertex",
            ] ,
            'author' => [
                'slug' => $author->slug,
                'id' => $author->vertexId, 
                'name' => $author->name,
                'function' => isset($author->extras['function']) ? $author->extras['function'] : null,
                'connected' => $author->connected,
                'image' => $author->image ?? null,
            ],
            'count' => 0,
            'dislikes' => 0,
            'likes' => 0,
            'parent' => isset($result[0]) ? $result[0]['parentId'] : $vertexid,
            'store' => isset($result[0]) ? $result[0]['storeId'] : [],
        ];

        // broadcast new comment to listeners
        CommentCreated::dispatch($resource, $vertexid);

        // updateCounter parent counter
       $this->_notifyCommentCounterUpdate($vertexid);

       return $resource;
    }

    public function notifyCommentReplyOfAuthor($vertexid, $reply)
    {
        $result = $this->nebula->execute('MATCH (c:comment)-[has_creator]->(u:user) where id(c) == "'. $vertexid .'" return u as author,c as comment;');
        $user = revealidentifier($result[0]['identifier']);
        $user->sendCommentReplyOfNotification();
       
    }

    public function deleteComment($comment_id, $vertexid)
    {
        $comment = $this->nebula->execute('MATCH ()<-[e2:reply_of]-(c)-[e:has_creator]->(u) WHERE id(c) == "'. $comment_id .'" RETURN u, e, e2;');
        $children = $this->nebula->execute('MATCH (c:comment)-[r:reply_of*1..]->(d:comment) where id(d) == "'. $comment_id .'" RETURN id(c);');

        // check authorization
        if($comment[0]['u']['id'] != 'user'.$this->user->id ) {
            return response()->json('Opération impossible', 401);
        }

        // delete children
        foreach($children as $vertex_id) {
            $child = $this->nebula->execute('MATCH ()<-[e2:reply_of]-(c)-[e:has_creator]->(u) WHERE id(c) == "'. $vertex_id .'" RETURN u, e, e2;');
            $this->_internalDeleteComment($vertex_id, $child);
        }

        // delete comment
        $res =  $this->_internalDeleteComment($comment_id, $comment);

        if(!is_array($res)) {
            return response()->json($res, 500);
        } 

        CommentDeleted::dispatch($comment_id, $vertexid);

        // updateCounter parent counter
       $this->_notifyCommentCounterUpdate($vertexid);

        return response()->json('success', 200);

    }

    private function _internalDeleteComment($comment_id, $comment)
    {
        // delete vertex
        return $this->nebula->deleteVertex([$comment_id], true);
    }

    private function _notifyCommentCounterUpdate($vertexid)
    {
        $result = $this->nebula->execute('MATCH (c:comment)-[f:reply_of]->(a) WHERE id(c) =="'. $vertexid .'" 
        OPTIONAL MATCH (d:comment)-[g:reply_of]->(c) 
        return id(a) as parent, count(d) as total
        ');

        if(isset($result[0])) {
            CommentCalculated::dispatch( $result[0]['total'], $vertexid, $result[0]['parent']);
        }
    }

    /*
    | LIKES
    */

    // public function createLike($isLiked, $vertexid, $storeid)
    // {
    //     // clear previous
    //     $this->nebula->deleteEdge(config('socializer.nebulagraph.edges.liked_by.name'), [$vertexid.'->'.$this->user->vertexId]);
    //     $this->nebula->deleteEdge(config('socializer.nebulagraph.edges.disliked_by.name'), [$vertexid.'->'.$this->user->vertexId]);

    //     // do action
    //     $action = $isLiked ? 'liked_by' : 'disliked_by';
    //     $this->nebula->insertEdge(
    //         config('socializer.nebulagraph.edges.'. $action .'.name'), 
    //         [
    //             $vertexid.'->'.$this->user->vertexId => config('socializer.nebulagraph.edges.'. $action .'.props')
    //         ]
    //     );

    //     // get new status
    //     $res = $this->nebula->execute('
    //         MATCH (c:comment) WHERE id(c) =="'.$vertexid.'" 
    //         OPTIONAL MATCH (c)-[z:liked_by]->(:user) 
    //         OPTIONAL MATCH (c)-[x:disliked_by]->(:user) 
    //         RETURN count(z) as likes, count(x) as dislikes
    //     ');

    //     CommentLiked::dispatch($res[0], $vertexid, $storeid);

    //     return $res[0];
    // }
}