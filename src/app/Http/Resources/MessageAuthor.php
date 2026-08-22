<?php

namespace Dauvray\Socializer\app\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Charge utile `author` d'un message de chat — diffusion ET historique HTTP.
 *
 * Pourquoi une ressource à part plutôt que `Resources\User` filtrée : l'auteur d'un message part à
 * TOUS les membres du chat (`receivedMsg`, `updatedMsg`), et au destinataire hors room
 * (`NewChatMessageNotification`). Il était jusqu'ici filtré par une **liste noire**,
 * `filterSensibleDataUserRessource()`, qui retirait `email`, `created_at`, `roles`, `permissions`
 * et `channel` — mais laissait passer `groups` (avec `server_id`) et `unreadNotifications`.
 *
 * D'où les trois interdits, hérités d'E8 et vrais ici pour les mêmes raisons :
 *
 *  1. **Aucun `Auth::`**, ni direct ni transitif. Sur `updatedMsg` l'auteur EST toujours l'éditeur
 *     authentifié, et sur `receivedMsg` il l'est dans le cas ordinaire : le garde
 *     `if ($this->id === Auth::user()?->id)` d'`EstarterUserResource` y concluait donc « c'est
 *     moi » et livrait le bloc privé à toute la room.
 *  2. **Aucune délégation à `EstarterUserResource`** ni à `Resources\User`. Ce n'est pas une
 *     précaution de style : `Resources\User` ajoute son propre `groups` (avec `server_id`) **sans
 *     condition**, en plus du bloc privé d'estarter. Deux sources, pas une — et c'est la seconde
 *     que la liste noire ne pouvait pas connaître, ayant été écrite avant elle.
 *  3. **Liste blanche, jamais liste noire.** Un `unset()` ferme les champs d'aujourd'hui et laisse
 *     passer celui qu'on ajoutera demain en amont. C'est exactement ce qui s'est produit ici.
 *
 * Le périmètre ci-dessous est le relevé des lectures réelles côté front (22/08/2026) : `slug` porte
 * l'alignement « moi » et l'accès aux outils d'édition (`MessageWidget`, `MessageTools`), le reste
 * est ce qu'affichent `Gravatar`, `GravatarStatus` et `WallLink`. Épinglé par
 * `tests/Feature/Chat/AuthorPayloadTest.php`.
 *
 * Il coïncide aujourd'hui avec celui de `PresenceUser` — deux contrats sur deux surfaces, libres de
 * diverger. Toute charge utile de mur ou de profil continue de passer par `Resources\User`, où
 * `identifier`, `may_reach`, `groups` et `nb_followers` sont légitimement lus.
 */
class MessageAuthor extends JsonResource
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
