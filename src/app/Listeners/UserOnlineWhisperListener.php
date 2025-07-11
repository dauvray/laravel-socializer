<?php

namespace Dauvray\Socializer\app\Listeners;

use Illuminate\Support\Facades\Auth;

class UserOnlineWhisperListener
{
    public $service;
    public $user;
    
    /**
     * Create the event listener.
     *
     * @return void
     */
    public function __construct()
    {
        $this->user = Auth::user();
    }

    /**
     * Handle the event.
     *
     * @param  Verified  $event
     * @return void
     */
    public function handle(object $event): void
    {
        $message = $event->message;
        $payload = json_decode($message, true);
        $data = $payload['data'] ?? [];

        switch($payload['event']) {
            case 'client-ping':
                $this->clientPingOnline($data);
                break;
            case 'client-leave-feed':
                $this->clientLeaveFeed($data);
                break;
            case 'client-leave-chat':
                $this->clientLeaveChat($data);
                break;
            case 'client-leave-server':
                $this->clientLeaveServer($data);
                break;
            case 'client-leave-room':
                $this->clientLeaveRoom($data);
                break;
            default:
                // Handle other events if necessary
                break;
        }
    }

    // user still online
    private function clientPingOnline(array $data)
    {
        $userId = $data['userId'] ?? null;

        if (!$userId) {
            return;
        }

        $user = config('estarter.models.user')::find($userId);
        app('onlineUsers')->updateUserOnlineStatus($user);
    }

    private function clientLeaveFeed(array $data)
    {
        $userId = $data['userId'] ?? null;
        $feedId = $data['feedId'] ?? null;

        if (!$userId || !$feedId) {
            return;
        }

        app('onlineUsers')->removeUserItem('feed', $feedId, $userId);
    }

    private function clientLeaveChat(array $data)
    {
        $userId = $data['userId'] ?? null;
        $chatId = $data['chatId'] ?? null;

        if (!$userId || !$chatId) {
            return;
        }

        app('onlineUsers')->removeUserItem('chat', $chatId, $userId);
    }

    private function clientLeaveServer(array $data)
    {
        $userId = $data['userId'] ?? null;
        $serverId = $data['serverId'] ?? null;

        if (!$userId || !$serverId) {
            return;
        }

        app('onlineUsers')->removeUserItem('server', $serverId, $userId);
    }

    private function clientLeaveRoom(array $data)
    {
        $userId = $data['userId'] ?? null;
        $roomId = $data['roomId'] ?? null;

        if (!$userId || !$roomId) {
            return;
        }

        app('onlineUsers')->removeUserItem('room', $roomId, $userId);
    }

}
