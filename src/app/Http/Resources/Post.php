<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;


class Post extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return array
     */
    public function toArray($request)
    {
        $post = $this->resource['post'];
        $user = $this->resource['user'];

        return [
            'post' => [
                'content' => $post['content'],
                'created_at' => $post['created_at'],
                'id' => $post['mongoid'],
                'vertexid' => $post['id'],
                'identifier' => $post['identifier'],
                'nb_comments' => $this->resource['nb_comments'] ?? 0,
                'likes' => $this->resource['likes'] ?? 0,
                'dislikes' => $this->resource['dislikes'] ?? 0,
                'shares' => $this->resource['shares'] ?? 0,
                'type' => $this->resource['type'] ?? $post['type'] ?? null,
                'shared_by' => $this->resource['shared_by'] ?? $post['shared_by'][0] ?? [],
            ],
           'author' => [
                'function' => $user['function'],
                'name' => $user['name'],
                'slug' => $user['slug'],
                'identifier' => $user['identifier'],
                'connected' => $user['connected'],
                'image' => $user['image'],
           ]
        ];
    }
}
