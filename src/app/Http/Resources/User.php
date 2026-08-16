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
            'function' => $this->resource->function,
            'identifier' => $this->resource->identifier,
            'auth_provider' => Auth::user()?->name,
            'is_me' => $is_me,
            'is_bot' => $this->resource?->is_bot == 1 ? 1 : 0,
            'followed' => $this->when(isset($this->resource->follow_status), function () {
                return $this->resource->follow_status == 'followed' ? true : false;
            }),
            'nb_followers' => $this->resource->nb_followers,
            // Verdict de la règle de relation (C2), posé par `Users::getGraphUser` — donc
            // présent sur la charge utile du mur, absent partout ailleurs. Le front s'en sert
            // pour ne pas afficher un bouton d'appel qui partirait en 403.
            //
            // ⚠️ `isset()` et non `array_key_exists` : identique au `followed` ci-dessus, et
            // sans conséquence ici puisque le verdict est un booléen, jamais null. C'est ce
            // qui permet au front de traiter l'ABSENCE de clé comme un refus.
            'may_reach' => $this->when(isset($this->resource->may_reach), function () {
                return (bool) $this->resource->may_reach;
            }),
            'cover' => $this->resource->extras['cover'] ?? $this->resource?->cover ?? null,
            'vertexid' => isset($this->resource->vertexid) ? $this->resource->vertexid : null,
            'channel' => $this->when($is_me, function () use ($user_id) {
                return 'App.Models.User.' . $user_id;
            }),
            // todo : a revoir, créé un bug N+1
            // 'servers' => $this->when($current_user->ownedServers(), function () use ($current_user){
            //     return $current_user->ownedServers();
            // }),
            // 'servers' => [], // temporaire, pour éviter le bug N+1, à revoir une fois que la partie serveur sera stabilisée
            // end todo
            'groups' => $current_user->groups->map(function($group) {
                return [
                    'name' => $group['name'] ?? null,
                    'is_leader' => $group->pivot->is_leader ?? false,
                    'server_id' => $group->extras['socializer_server_vid'] ?? null,
                ];
            }),
        ];

       // unset($baseData['groups']); // on unset les données qui sont déjà présentes dans la ressource de base pour éviter les doublons
//dd(array_merge( $baseData, $currentData));
        // Fusion des données
        return array_merge( $baseData, $currentData);
    }
}
