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

    /*************************************
     * GESTION DES FILS D'ACTUALITÉS
     */

    /**
     * Définit la liste des feeds de l'utilisateur.
     * @param array $feedIds
     * @param int|string|null $userId
     * @return void
     */
    public function setUserFeeds(array $feedIds, int|string|null $userId = null): void
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $this->redisService->hSet("user:$userId:presence", 'feeds', json_encode($feedIds));
    }

    /**
     * Récupère la liste des feeds de l'utilisateur.
     *
     * @param int|string|null $userId
     * @return array
     * @return array<string>
     */
    public function getUserFeeds(int|string|null $userId = null): array
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $feeds = $this->redisService->hGet("user:$userId:presence", 'feeds', true);

        return is_array($feeds) ? $feeds : [];
    }

    /**
     * Ajoute un feed_id à la liste des feeds de l'utilisateur.
     *
     * @param int|string $feedId
     * @param int|string $userId
     * @return void
     */
    public function addUserFeed(int|string $feedId, int|string|null $userId = null): void
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $feeds = $this->getUserFeeds($userId);
        if (!in_array($feedId, $feeds)) {
            $feeds[] = $feedId;
            $this->setUserFeeds($feeds, $userId);
            $this->redisService->sadd("presence:feed:$feedId", $userId);
        }
    }

    /**
     * Vérifie si un utilisateur a un feed_id dans sa liste de feeds.
     *
     * @param int|string $feedId
     * @param int|string $userId
     * @return bool
     */
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
     * @return void
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
        $this->redisService->srem("presence:feed:$feedId", $userId);
    }

    /*************************************
     * GESTION DES CHATS
     */

     /**
     * Ajoute un chat_id à la liste des chats de l'utilisateur.
     *
     * @param int|string $userId
     * @param int|string $chatId
     * @return void
     */
    public function addUserChat(int|string $chatId, int|string|null $userId = null): void
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $chats = $this->getUserChats($userId);
        if (!in_array($chatId, $chats)) {
            $chats[] = $chatId;
            $this->setUserChats($chats, $userId);
            $this->redisService->sadd("presence:chat:$chatId", $userId);
        }
    }

     /**
     * Récupère la liste des chats de l'utilisateur.
     *
     * @param int|string|null $userId
     * @return array
     * @return array<string>
     */
    public function getUserChats(int|string|null $userId = null): array
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $chats = $this->redisService->hGet("user:$userId:presence", 'chats', true);

        return is_array($chats) ? $chats : [];
    }

    /**
     * Définit la liste des feeds de l'utilisateur.
     * @param array $feedIds
     * @param int|string|null $userId
     * @return void
     */
    public function setUserChats(array $chatIds, int|string|null $userId = null): void
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $this->redisService->hSet("user:$userId:presence", 'chats', json_encode($chatIds));
    }

    /**
     * Supprime un chat_id de la liste des chats de l'utilisateur.
     * 
     * @param int|string $chatId
     * @param int|string $userId
     * @return void
     */
    public function removeUserChat(int|string $chatId, int|string|null $userId = null): void
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        $chats = array_filter(
            $this->getUserChats($userId),
            fn($id) => (string)$id !== (string)$chatId
        );

        $this->setUserChats(array_values($chats), $userId);
        $this->redisService->srem("presence:chat:$chatId", $userId);
    }

    /**
     * Vérifie si un utilisateur a un feed_id dans sa liste de feeds.
     *
     * @param int|string $chatId
     * @param int|string $userId
     * @return bool
     */
    public function hasUserChat(int|string $chatId, int|string|null $userId = null): bool
    {
        if (!$userId) {
            $userId = $this->user->id;
        }

        return $this->redisService->sIsMember("presence:chat:$chatId", $userId);
    }

}