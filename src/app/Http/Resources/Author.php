<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Dauvray\Estarter\app\Http\Resources\ExtendedJsonResource;
use Dauvray\Estarter\app\Http\Resources\Author as EstarterAuthorResource;

class Author extends ExtendedJsonResource
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
            $this->mergeResource($request, EstarterAuthorResource::class),
            'slug' => $this->slug,
            'vertexid' => $this->vertexId, 
           // 'profile' => route('user.wall', ['slug' => $this->slug]),
        ];
    }
}
