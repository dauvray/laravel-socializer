<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class Message extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @param  Request  $request
     * @return array
     */
    public function toArray($request)
    {
        $author = config('estarter.models.user')::find($this->model_id);

        return [
            'message' => $this->message,
            'created_at' => $this->created_at,
            // Même ressource que la diffusion : le front rend l'historique et le temps réel par
            // les mêmes bindings (`item.author`). Deux formes divergentes rendraient vraie la plus
            // permissive des deux.
            'author' => new MessageAuthor($author),
            'id' => $this->vertexid,
            'extras' => $this->extras,
        ];
    }
}
