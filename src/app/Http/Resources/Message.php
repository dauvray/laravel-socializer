<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;
use Dauvray\Socializer\app\Http\Resources\User as UserResource;

class Message extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return array
     */
    public function toArray($request)
    {
        $author = config('estarter.models.user')::find($this->model_id);

        return [
            'message' => $this->message,
            'created_at' => $this->created_at,
            'author' => new UserResource($author),
        ];
    }
}
