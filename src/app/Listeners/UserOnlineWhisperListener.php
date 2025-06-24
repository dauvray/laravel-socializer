<?php

namespace Dauvray\Socializer\app\Listeners;

class UserOnlineWhisperListener
{
    public $service;
    
    /**
     * Create the event listener.
     *
     * @return void
     */
    public function __construct()
    {

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

        $user = config('estarter.models.user')::find($userId);
        app('onlineUsers')->removeUserFeed($feedId, $userId);
    }
}
