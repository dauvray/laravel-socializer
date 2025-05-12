<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;
use Dauvray\Eblogger\app\Http\Resources\CommentCollection;
use Dauvray\Socializer\app\Http\Resources\User as UserResource;
use Dauvray\Socializer\app\Http\Resources\Room as RoomResource;
//use Dauvray\Socializer\app\Http\Resources\RoomCollection;

class Server extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return array
     */
    public function toArray($request)
    { 
        return [
            'name' => $this->resource['name'],
            'id' => $this->resource['id'],
            // 'slug' => $this->slug,
            // 'type' => $this->type,
            // 'users' => UserResource::collection($this->users),
            // 'owner' => new UserResource($this->user),
            // 'summary' => $this->summary,
            // 'image' => [
            //     'large' => $this->getThumbnail('large'),
            //     'medium' => $this->getThumbnail('medium'),
            //     'small' => $this->getThumbnail('small'),
            // ],
        //     'link' => route('networks.show', $this->slug),
        //     'description' => $this->description,
        //     'is_private' => $this->is_private ? true : false,
        //    // 'rooms' => new RoomCollection($this->rooms()->where('status', 1)->get()),
        //     'rooms' => RoomResource::collection($this->whenLoaded('rooms')),
        ];
    }
}
