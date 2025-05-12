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
        $currentData = [
            'slug' => $this->slug,
            'identifier' => $this->identifier,
            'auth_provider' =>Auth::user()->name,
            'is_me' => revealIdentifier($this->identifier)->id === Auth::user()->id,
            'followed' => $this->when(isset($this->follow_status), function () {
                return $this->follow_status == 'followed' ? true : false;
            }),
            'nb_followers' => $this->nb_followers,
            'cover' => isset($this->extras) && isset($this->extras['cover']) ? $this->extras['cover'] : null,
            'vertexid' => isset($this->vertexid) ? $this->vertexid : null,
        ];

        // Fusion des données
        return array_merge($baseData, $currentData);
    }
}
