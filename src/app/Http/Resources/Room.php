<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class Room extends JsonResource
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
            'id' => $this->id,
            'name' => $this->name,
            'type' => $this->type,
            'private' => $this->is_private,
            'feed_id' => $this->feed ? $this->feed->id : null,
            'extras' => $this->extras,
        ];
    }
}
