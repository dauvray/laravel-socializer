<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;
use Dauvray\Eblogger\app\Http\Resources\CommentCollection;
use Dauvray\Socializer\app\Http\Resources\User as UserResource;
use Dauvray\Socializer\app\Http\Resources\Room as RoomResource;
//use Dauvray\Socializer\app\Http\Resources\RoomCollection;
use Dauvray\Estarter\app\Helpers\ModelTraits\Thumbnails;

class Server extends JsonResource
{
    use Thumbnails;
    /**
     * Transform the resource into an array.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return array
     */
    public function toArray($request)
    {
        $server = $this->resource['s'];
        $owner = $this->resource['o'];

        $image = json_decode($server['image'])[0] ?? null;

        return [
            'name' => $server['name'],
            'id' => $server['id'],
            'image' => $image?->name ? '/serve-thumbnail/'. $image?->name .'/large' : null,
            'description' => $server['description'],
            'is_private' => $server['privacy'] == 1 ? true : false,
            'owner' => [
                'connected' => $owner['connected'],
                'name' => $owner['name'],
                'slug' => $owner['slug'],
                'image' => $owner['image'],
                'function' => $owner['function'],
            ],
        ];
    }
}
