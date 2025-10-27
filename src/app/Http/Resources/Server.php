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
        $image = json_decode($this->resource['image'])[0] ?? null;

        return [
            'name' => $this->resource['name'],
            'id' => $this->resource['id'],
            // 'slug' => $this->slug,
            // 'type' => $this->type,
            // 'users' => UserResource::collection($this->users),
            // 'owner' => new UserResource($this->user),
            // 'summary' => $this->summary,
            'image' => $image?->name ? '/serve-thumbnail/'. $image?->name .'/large' : null,
        //     'link' => route('networks.show', $this->slug),
            'description' => $this->resource['description'],
            'is_private' => $this->resource['privacy'] == 1 ? true : false,
        //    // 'rooms' => new RoomCollection($this->rooms()->where('status', 1)->get()),
        //     'rooms' => RoomResource::collection($this->whenLoaded('rooms')),
        ];
    }
}
