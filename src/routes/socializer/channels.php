<?php

use App\Models\User;
use Illuminate\Support\Facades\Broadcast;
use Dauvray\Socializer\app\Http\Resources\User as UserResource;


/*-----------------------------------
| Private channels
------------------------------------*/
Broadcast::channel('App.Models.User.{userId}', function (User $user, int $userId) {
    return (int) $user->id === (int)$userId;
});

// evenements de chat
Broadcast::channel('chat.{chatId}', function (User $user, string $chatId) {
    if ($user->canJoinchatRoom($chatId)) {
        return new UserResource($user);
    }
});

Broadcast::channel('room.{roomId}', function (User $user, string $roomId) {
    if ($user->canJoinRoom($roomId) || $user->isCreator($roomId)) {
        return new UserResource($user);
    }
});

Broadcast::channel('server.{serverId}', function (User $user, string $serverId) {
    if ($user->canJoinServer($serverId)) {
        return new UserResource($user);
    }
});

Broadcast::channel('questionnaire.{roomId}', function (User $user, string $roomId) {
    if ($user->canJoinRoom($roomId) || $user->isCreator($roomId)) {
        return new UserResource($user);
    }
});

