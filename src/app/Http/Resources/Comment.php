<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Dauvray\Estarter\app\Http\Resources\ExtendedJsonResource;

class Comment extends ExtendedJsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return array
     */
    public function toArray($request)
    {
        // from nebula ( list )
        if(is_array($this->resource)) {
            $this->resource['comment']['content'] = html_entity_decode($this->resource['comment']['content']);
            return $this->resource;
        }
        
        return false;
    }
}
