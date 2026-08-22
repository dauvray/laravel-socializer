<?php

use App\Models\User;
use Dauvray\Socializer\app\Http\Resources\PresenceUser;
use Illuminate\Support\Facades\Broadcast;

/*-----------------------------------
| Private channels
------------------------------------*/

Broadcast::channel('App.Models.User.{userId}', function (User $user, int $userId) {
    return (int) $user->id === (int) $userId;
});

/*-----------------------------------
| Presence channels
|
| ⚠️ Ce que renvoie un canal de présence devient le `user_info` que Reverb rediffuse à TOUS les
| autres membres. Jamais `Resources\User` ici : elle est fabriquée pendant le `/broadcasting/auth`
| du sujet lui-même, donc son garde sur `Auth::user()` livre le bloc privé (email, rôles,
| permissions, groupes) à toute la room. C'est `PresenceUser` — liste blanche, aucune identité de
| requête consultée. Épinglé par tests/Feature/Channels/PresencePayloadTest.php.
------------------------------------*/

// evenements de chat
Broadcast::channel('chat.{chatId}', function (User $user, string $chatId) {
    if ($user->canJoinchatRoom($chatId)) {
        return new PresenceUser($user);
    }
});

Broadcast::channel('room.{roomId}', function (User $user, string $roomId) {
    if ($user->canJoinRoom($roomId) || $user->isCreator($roomId)) {
        return new PresenceUser($user);
    }
});

Broadcast::channel('server.{serverId}', function (User $user, string $serverId) {
    if ($user->canJoinServer($serverId)) {
        return new PresenceUser($user);
    }
});

Broadcast::channel('questionnaire.{roomId}', function (User $user, string $roomId) {
    if ($user->canJoinRoom($roomId) || $user->isCreator($roomId)) {
        return new PresenceUser($user);
    }
});
