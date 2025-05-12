<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;
use Dauvray\Socializer\app\Events\ItemLiked;

class Likes
{
    public $nebula = null;
    public $user = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->user = Auth::user();
    }

    public function createLike($isLiked, $vertexid, $storeid, $type)
    {
        // clear previous
        $this->nebula->deleteEdge(config('socializer.nebulagraph.edges.liked_by.name'), [$vertexid.'->'.$this->user->vertexId]);
        $this->nebula->deleteEdge(config('socializer.nebulagraph.edges.disliked_by.name'), [$vertexid.'->'.$this->user->vertexId]);

        // do action
        $action = $isLiked ? 'liked_by' : 'disliked_by';
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.'. $action .'.name'), 
            [
                $vertexid.'->'.$this->user->vertexId => config('socializer.nebulagraph.edges.'. $action .'.props')
            ]
        );

        // get new status
        $res = $this->nebula->execute('
            MATCH (c) WHERE id(c) =="'.$vertexid.'" 
            OPTIONAL MATCH (c)-[z:liked_by]->(:user) 
            OPTIONAL MATCH (c)-[x:disliked_by]->(:user) 
            RETURN count(z) as likes, count(x) as dislikes
        ');

        ItemLiked::dispatch($res[0], $vertexid, $storeid, $type);

        return $res[0];
    }
}