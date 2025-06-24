<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;
use Dauvray\Socializer\app\Models\Post;
use Dauvray\Socializer\app\Http\Resources\PostCollection;
use Dauvray\Socializer\app\Http\Resources\Post as PostResource; 
use Dauvray\Socializer\app\Events\PostDeletedEvent;
use Dauvray\Socializer\app\Jobs\SendPostToFollowers;
use Dauvray\Socializer\app\Jobs\DeletePostToFollowers;

class Feed
{
    public $nebula = null;
    public $user = null;
    public $usersOnlineService = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->user = Auth::user();
        $this->usersOnlineService = app('onlineUsers');
    }

    public function getFeed($vertexid = null, $type = 'wall')
    {
        $result = app('nebulaGraph')->execute("
            MATCH (u:user)<-[:owned_by]-(f:$type) WHERE id(u) == '$vertexid' RETURN f
        ");

        if(!count($result)) {
            return ['message' => "$type introuvable"];
        }

        $feed = (object)$result[0];

        // on ne post que sur son wall
        // dans le cas d'un type feed on recupere le questionnaire du wall correspondant a cet utilisateur
        if( $type == 'feed') {
            $result = app('nebulaGraph')->execute("
                MATCH (u:user)<-[:owned_by]-(w:wall) WHERE id(u) == '$vertexid' RETURN w
            ");
            $userWall = (object)$result[0];
        }

        return [
            'id' => $feed->id,
            'questionnaire' => $type == 'wall' ? $feed->questionnaire_id : $userWall->questionnaire_id
        ];
    }

    public function getFeedPosts($feed_id = null)
    {
        $user_vertextid = $this->user->vertexid;

        // set user in online feed connections
        $this->usersOnlineService->addUserFeed($feed_id);

        $posts_nebula = app('nebulaGraph')->execute("
            MATCH (author:user)<-[:has_creator]-(p:post)-[:published_in]->(f) 
            WHERE id(f) == '$feed_id'
            OPTIONAL MATCH (c:comment)-[r:reply_of]->(p) 
            OPTIONAL MATCH (p)-[z:liked_by]->(:user) 
            OPTIONAL MATCH (p)-[x:disliked_by]->(:user)
            OPTIONAL MATCH (p)<-[sh:sharing_of]-(:share)
            RETURN p AS post, author AS user, p.created_at AS createdAt, count(DISTINCT c) as nb_comments, 
            count(DISTINCT z) as likes, count(DISTINCT x) as dislikes, count(DISTINCT sh) as shares, 
            'original' AS type, null AS shared_by 
            ORDER BY createdAt DESC 

            UNION  

            MATCH (u:user)<-[:shared_by]-(share)-[:shared_in]->(f), (share)-[:sharing_of]->(p:post)-[:has_creator]->(author:user) 
            WHERE id(f) == '$feed_id' AND id(author) != '$user_vertextid'
            OPTIONAL MATCH (c:comment)-[r:reply_of]->(p) 
            OPTIONAL MATCH (p)-[z:liked_by]->(:user) 
            OPTIONAL MATCH (p)-[x:disliked_by]->(:user)
            OPTIONAL MATCH (p)<-[sh:sharing_of]-(:share)
            RETURN p AS post, author AS user,p.created_at AS createdAt, count(DISTINCT c) as nb_comments, 
            count(DISTINCT z) as likes, count(DISTINCT x) as dislikes, count(DISTINCT sh) as shares, 
            'shared' AS type, u AS shared_by 
            ORDER BY createdAt DESC 
         ");

        // extract mongo Ids and prepare
        $mongo_ids = [];
        $final_list = [];

        foreach($posts_nebula as $item) {
            $mongo_id = $item['post']['mongoid'];
            $mongo_ids[] = $mongo_id;
            $final_list[$mongo_id] = $item;
        }
    
        // search in mogo
        $posts_mongo = Post::Find($mongo_ids);

        // insert post
        foreach( $posts_mongo as $item) {
          $final_list[$item->id]['post']['content'] = $item->model['POST'];
          $final_list[$item->id]['post']['identifier'] = hideIdentifier($item);
        }

        // tri par date decroissante
        usort($final_list, function ($a, $b) {
            return strtotime($b['post']['created_at']) - strtotime($a['post']['created_at']);
        });

        $paginator = makePaginationCollection(collect(array_values($final_list)), route('feed.posts', $feed_id));

        return new PostCollection($paginator);
    }

    public function sendFeedPost($request)
    {
        $model = $request->get('model');
        $formated = formatTextToContent($model['POST']);
        $model['POST'] = $formated['content'];
        $feed_id = $this->user->wall();

        $post = Post::create([
            'feed_id' => $feed_id,
            'questionnaire_id' => $request->get('questionnaire_id'),
            'model' => $model,
            'model_id' => $this->user->id,
            'model_type' => get_class($this->user)
        ]);

        if(!$post) {
            return false;
        }

        $post_identifier = hideIdentifier($post);

        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.post.name'), 
            array_merge(
                $this->nebula->populatePropsFromPattern(
                    $post,
                    config('socializer.nebulagraph.vertices.post')
                ),
                [
                    'mongoid' => $post->id,
                    'identifier' => $post_identifier
                ]  
            )
        );

        $vid = getVertexIdFromInsert($vertex);

        if(!$vid) {
            return false;
        }

        // post / feed relation
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.published_in.name'), 
            [
                $vid.'->'.$feed_id => config('socializer.nebulagraph.edges.published_in.props')
            ]
        );

        // post / author relation
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.has_creator.name'), 
            [
                $vid.'->'.$this->user->vertexid => config('socializer.nebulagraph.edges.has_creator.props')
            ]
        );

        $post->vertexid = $vid;
        $post->type = 'original';
        $post->shared_by = null;
        $post->save();

        $resource = $this->_formatPostToResource($post, $post_identifier);

        // to queue
        SendPostToFollowers::dispatch($resource, $feed_id);

        return $resource;
    }

    private function _formatPostToResource( $post, $post_identifier, $author = null)
    {
        $formated_post = [
            'post' => $post,
            'user' => $author ? $author : $this->user,
        ];

        $formated_post['post']['content'] = $post->model['POST'];
        $formated_post['post']['mongoid'] = $post->id;
        $formated_post['post']['id'] = $post->vertexid;
        $formated_post['post']['identifier'] = $post_identifier;

        return new PostResource($formated_post);
    }

    public function deleteFeedPost($request)
    {
        $post_id = $request->get('post_id');
        $feed_id = $request->get('feed_id');

        $post = Post::find($post_id);
        $vid = $post->vertexid;
        $post->delete();

        // delete shared posts
        $share_ids = [];
        $shares = $this->nebula->execute("MATCH (p:post)<-[:sharing_of]-(s:share) WHERE id(p) == '$vid' RETURN s");
        foreach($shares as $share) {
            $share_ids[] = $share['id'];
        }
        if(count($share_ids)) {
            $this->nebula->deleteVertex($share_ids, true);
        }

        // get feed followers
        $feed_followers = $this->nebula->execute("MATCH (p:post)-[:published_in]->(f:feed) WHERE id(p) == '$vid' RETURN f");

        // delete post in Nebula
        $this->nebula->deleteVertex([$vid], true);

        // broadcast delete to author
        PostDeletedEvent::dispatch($post_id, $feed_id);

        // broadcast delete to followers
        foreach($feed_followers as $feed) {
            DeletePostToFollowers::dispatch($post_id, $feed['id']);
        }

        return response()->json('success', 200);
    }

    public function shareFeedPost($request)
    {
        $post_vid = $request->get('post_vid');
        $feed_vid = $request->get('feed_vid');

        $result = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.share.name'), 
                []
        );

        $shared_post_vid = getVertexIdFromInsert($result);

        // shared_post / original post
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.sharing_of.name'), 
            [
                $shared_post_vid.'->'.$post_vid => config('socializer.nebulagraph.edges.sharing_of.props')
            ]
        );
        
        // shared_post / author relation    
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.shared_by.name'), 
            [
                $shared_post_vid.'->'.$this->user->vertexid => config('socializer.nebulagraph.edges.shared_by.props')
            ]
        );

        // shared_post / feed relation
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.shared_in.name'), 
            [
                $shared_post_vid.'->'.$feed_vid => config('socializer.nebulagraph.edges.shared_in.props')
            ]
        );

        // send to followers
        $feed_id = $this->user->wall();

        $original_post = Post::where('vertexid', $post_vid)->first();
        $original_post_author = $original_post->model_type::find($original_post->model_id);
        $original_post->type = 'shared';

        $shared_by = $this->user->vertexid;
        $original_post->shared_by = $this->nebula->execute("Match (u:user) where id(u)== '$shared_by' return u");
        
        $resource = $this->_formatPostToResource($original_post , hideIdentifier($original_post), $original_post_author);

        // to queue
        SendPostToFollowers::dispatch($resource, $feed_id);

        return $resource;
    }

    public function feedSubscribeAlert($request)
    {
        $questionnaire_id = $request->get('questionnaire_id');
        $filters = $request->get('filters');
        $hash = $request->get('hash');
        $user_id = $this->user->id;

        $alert = config('socializer.models.alert')::where([
            ['questionnaire_id', $questionnaire_id],
            ['hash', $hash],
            ['user_id', $user_id],
        ])->first();

        if(!$alert) {
            $result = config('socializer.models.alert')::create([
                'questionnaire_id' =>  $questionnaire_id,
                'hash' => $hash,
                'search' => $filters,
                'user_id' => $user_id
            ]);

            if($result) {
                return response()->json(['message' => 'Alerte enregistrée'], 200);
            } else {
                return response()->json(['message' => 'Enregistrement impossible'], 404);
            }

        } else {
            return response()->json(['message' => 'Une alerte existe déjà pour cette recherche'], 404);
        }
    }
}