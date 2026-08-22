<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Charge utile `user_info` d'un canal de PRÉSENCE — et rien d'autre.
 *
 * Pourquoi une ressource à part plutôt que `Resources\User` : celle-ci est construite pendant le
 * `/broadcasting/auth` **du membre qu'elle décrit**, puis Reverb la rediffuse à TOUS les autres
 * membres (`here`, `member_added`). Or `Auth::user()` y est donc toujours le sujet de la donnée :
 * le garde `if ($this->id === Auth::user()?->id)` d'`EstarterUserResource` y concluait
 * systématiquement « c'est moi » et livrait le bloc privé — `email`, `roles`, `permissions`,
 * `groups`, `unreadNotifications` — à toute la room.
 *
 * D'où les trois interdits qui font tout l'intérêt de ce fichier :
 *
 *  1. **Aucun `Auth::`**, ni direct ni transitif. Un garde qui dépend de `Auth::user()` ne veut
 *     plus rien dire dans un contexte où `Auth::user()` est toujours le sujet de la donnée.
 *  2. **Aucune délégation à `EstarterUserResource`** ni à `Resources\User`. Ce n'est pas une
 *     précaution de style : `Resources\User` ajoute son propre `groups` (avec `server_id`) **sans
 *     condition**, en plus du bloc privé d'estarter. Deux sources, pas une.
 *  3. **Liste blanche, jamais liste noire.** Un `unset()` ferme les champs d'aujourd'hui et laisse
 *     passer celui qu'on ajoutera demain en amont.
 *
 * Le périmètre ci-dessous est le relevé des lectures réelles côté front (21/08/2026, refait avec
 * E8) : `slug` est le pivot de l'admission des pairs WebRTC2
 * (`usePeerConnections._doGetRoomUsersDiff`) — un champ retiré à l'aveugle casse une poignée de
 * main, pas seulement un affichage. Épinglé par `tests/Feature/Channels/PresencePayloadTest.php`.
 *
 * Toute charge utile HTTP continue de passer par `Resources\User` : cette ressource-ci ne convient
 * PAS à un mur ou à un profil, où `identifier`, `may_reach` ou `groups` sont légitimement lus.
 */
class PresenceUser extends JsonResource
{
    /**
     * @param  Request  $request
     * @return array{id: int|null, name: string|null, slug: string|null, image: mixed, function: string|null, connected: int}
     */
    public function toArray($request)
    {
        return [
            'id' => $this->resource->id,
            'name' => $this->resource->name,
            'slug' => $this->resource->slug,
            'image' => $this->resource->image ?? null,
            // Attribut factice d'`EstarterUser` (`getFunctionAttribute` lit `extras['function']`).
            'function' => $this->resource->function ?? null,
            // Volontairement le service, et non l'attribut `connected` du modèle : c'est
            // l'expression qu'`EstarterUserResource` emploie déjà — donc aucun changement de
            // valeur — et la seule qui ne dépende pas d'un accesseur défini hors de ce paquet.
            'connected' => app('onlineUsers')->isOnlineUser($this->resource->id) ? 1 : 0,
        ];
    }
}
