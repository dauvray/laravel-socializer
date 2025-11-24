<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Dauvray\Estarter\app\Http\Resources\User as EstarterUserResource;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Auth;
//use Dauvray\Socializer\app\Http\Resources\Network as NetworkResource;

class User extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return array
     */
    public function toArray($request)
    {
        // On commence par récupérer les données de la ressource de base (EstarterUserResource)
        $baseData = (new EstarterUserResource($this->resource))->toArray($request);

        // Ensuite, on définit les données spécifiques à cette ressource (Socializer)
        $current_user = revealIdentifier($this->resource->identifier);
        $user_id = $current_user->id ?? null;
        $is_me = $user_id === Auth::user()?->id;

        $currentData = [
            'id' => $this->resource->id,
            'slug' => $this->resource->slug,
            'identifier' => $this->resource->identifier,
            'auth_provider' => Auth::user()?->name,
            'is_me' => $is_me,
            'is_bot' => $this->resource?->is_bot == 1 ? 1 : 0,
            'followed' => $this->when(isset($this->resource->follow_status), function () {
                return $this->resource->follow_status == 'followed' ? true : false;
            }),
            'nb_followers' => $this->resource->nb_followers,
            'cover' => $this->resource->extras['cover'] ?? $this->resource?->cover ?? null,
            'vertexid' => isset($this->resource->vertexid) ? $this->resource->vertexid : null,
            'channel' => $this->when($is_me, function () use ($user_id) {
                return 'App.Models.User.' . $user_id;
            }),
            'servers' => $this->when($current_user->ownedServers(), function () use ($current_user){
                return $current_user->ownedServers();
            }),
        ];

        // Fusion des données
        return array_merge($baseData, $currentData);
    }
}
