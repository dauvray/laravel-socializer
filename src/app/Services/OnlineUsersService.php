<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;
use App\Models\User;
use Dauvray\Socializer\app\Services\RedisService;

class OnlineUsersService implements \Dauvray\Estarter\app\Contracts\OnlineUsersServiceInterface
{
    public $nebula = null;
    public $redisService = null;
    public $user = null;
    public $online_key = 'app:users_online';

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->redisService = new RedisService();
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

        $this->redisService->zRem($this->online_key, $userId);
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

    /*************************************
     * GESTION DES FILS D'ACTUALITÉS
     * POUR LES UTILISATEURS EN LIGNE
     */

    public function setUserFeeds(array $feedIds, int|string|null $userId = null): void
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $this->redisService->hSet("user:$userId:presence", 'feeds', json_encode($feedIds));
    }

    public function getUserFeeds(int|string|null $userId = null): array
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $feeds = $this->redisService->hGet("user:$userId:presence", 'feeds', true);

        return is_array($feeds) ? $feeds : [];
    }

    public function addUserFeed(int|string $feedId, int|string|null $userId = null): void
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $feeds = $this->getUserFeeds($userId);
        if (!in_array($feedId, $feeds)) {
            $feeds[] = $feedId;
            $this->setUserFeeds($feeds, $userId);
        }
    }

    public function hasUserFeed(int|string $feedId, int|string|null $userId = null): bool
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        return in_array((string)$feedId, array_map('strval', $this->getUserFeeds($userId)), true);
    }

    /**
     * Supprime un feed_id de la liste des feeds de l'utilisateur.
     *
     * @param int|string $userId
     * @param int|string $feedId
     */
    public function removeUserFeed(int|string $feedId, int|string|null $userId = null): void
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $feeds = array_filter(
            $this->getUserFeeds($userId),
            fn($id) => (string)$id !== (string)$feedId
        );

        $this->setUserFeeds(array_values($feeds), $userId);
    }
}