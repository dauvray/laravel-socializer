<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;
use App\Models\User;


class OnlineUsersService implements \Dauvray\Estarter\app\Contracts\OnlineUsersServiceInterface
{
    public $nebula = null;
    public $redisService = null;
    public $user = null;
    public $online_key = 'app:users_online';

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->redisService = app('redisService');
        $this->user = Auth::user();
    }

    public function updateUserOnlineStatus(User|null $user = null) : void
    {
        if (!$user) {
            $user = $this->user;
        }

        $expireAt = now()->addMinutes(2)->timestamp;

        $this->redisService->zAdd($this->online_key, [$user->id => $expireAt]);
        $this->nebula->updateVertex(config('socializer.nebulagraph.tags.user.name'), 'user' . $user->id, ['connected' => 1]);
    }

    public function removeUserOnlineStatus( int|string|null $user_id = null, User|null $user = null) : void
    {
        $userId = $user?->id ?? $user_id ?? $this->user?->id;

        // delete in online users
        $this->redisService->zRem($this->online_key, $userId);

        // delete in all presence items
        $presences = $this->redisService->hGetAll("user:$userId:presence");
        foreach ($presences as $type => $itemIds) {
            $itemIds = json_decode($itemIds, true);
            if (is_array($itemIds)) {
                foreach ($itemIds as $itemId) {
                    $this->redisService->srem("presence:$type:$itemId", $userId);
                }
            }
        }   

        // delete user presence
        $this->redisService->del("user:$userId:presence");
        $this->nebula->updateVertex(config('socializer.nebulagraph.tags.user.name'), 'user' . $userId, ['connected' => 0]);
    }

    public function isOnlineUser(int|string|null $user_id = null, User|null $user = null) : bool
    {
        $userId = $user_id ?? $user?->id ?? $this->user?->id;

        if (!$userId) {
            return false; // aucun ID exploitable
        }

        return $this->redisService->zIsMember($this->online_key, $userId);
    }

    public function removeAllOutdatedUsersOnlineStatus() : void
    {
        $expiredAt = now()->subMinutes(2)->timestamp;

        // récupérer les membres expirés
        $expired_users = $this->redisService->zRangeByScore($this->online_key, '-inf', $expiredAt);

        if (!empty($expired_users)) {
           foreach ($expired_users as $userId) {

                $this->syncAppUserStatus($userId);
                $this->removeUserOnlineStatus($userId, null);

            }
        }
    }

    public function syncAppUserStatus(int|string|null $user_id = null) : void
    {
        // Synchroniser le statut de l'utilisateur de l'application
        if(!$user_id) {
           $user_id = $this->user->id;
        }

        User::where('id', $user_id)->update(['last_seen' => now()]);
    }

    /************ REDIS ONLINE USERS ****************** */

    public function addUserItem(string|null $type = null, int|string $itemId, int|string|null $userId = null)
    {
        if($type) {

            if (!$userId) {
                $userId = $this->user->id;
            }

            $items = $this->getUserItems($type, $userId);

            if (!in_array($itemId, $items)) {
                $items[] = $itemId;
                $this->setUserItems($type, $items, $userId);
                $this->redisService->sadd("presence:$type:$itemId", $userId);
            }
        }
    }

    public function getUserItems(string|null $type = null, int|string|null $userId = null)
    {
        if($type) {

            if (!$userId) {
                $userId = $this->user->id;
            }

            $items = $this->redisService->hGet("user:$userId:presence", $type, true);

            return is_array($items) ? $items : [];

        }
    }

    public function setUserItems(string|null $type = null, array $itemIds = [], int|string|null $userId = null)
    {
        if($type) {
            if (!$userId) {
                $userId = $this->user->id;
            }

            $this->redisService->hSet("user:$userId:presence", $type, json_encode($itemIds));
        }
    }

    public function hasUserItem(string|null $type = null, int|string $itemId, int|string|null $userId = null) 
    {
        if($type) {
            if (!$userId) {
                $userId = $this->user->id;
            }

            return in_array((string)$itemId, array_map('strval', $this->getUserItems($type, $userId)), true);
        }
    }

    public function removeUserItem(string|null $type = null, int|string $itemId, int|string|null $userId = null) 
    {
        if($type) {
            if (!$userId) {
                $userId = $this->user->id;
            }

            $items = array_filter(
                $this->getUserItems($type, $userId),
                fn($id) => (string)$id !== (string)$itemId
            );

            $this->setUserItems($type , array_values($items), $userId);
            $this->redisService->srem("presence:$type:$itemId", $userId);
        }
    }
}