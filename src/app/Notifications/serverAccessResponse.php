<?php

namespace Dauvray\Socializer\app\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
//use Illuminate\Notifications\Messages\MailMessage as Mailable;
use Illuminate\Notifications\Notification;
use Illuminate\Notifications\Messages\BroadcastMessage;
use Dauvray\Socializer\app\Services\OnlineUsersService;

class serverAccessResponse extends Notification implements ShouldQueue
{
    use Queueable;

    private $user;
    private $server;
    private $response;

    /**
     * Create a new notification instance.
     */
    public function __construct($user, $server, $response)
    {
        $this->user = $user;
        $this->server = $server;   
        $this->response = $response;
    }

    /**
     * Get the notification's delivery channels.
     *
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        $service = new OnlineUsersService();
        $isOnlineUser = $service->isOnlineUser($notifiable->id);

        $channels = ['database'];
        if ($isOnlineUser) {
            $channels[] = 'broadcast';
        }
        // if ($notifiable->email_verified_at) {
        //     $channels[] = 'mail';
        // }
        return $channels;
    }


    /**
     * Get the array representation of the notification.
     *
     * @return array<string, mixed>
     */
    public function toDatabase(object $notifiable): array
    {
        return [
            'notification_id' => $this->id,
            'from' => [
                'id' => $this->user->id,
                'name' => $this->user->name,
                'image' => $this->user->image,
                'function' => $this->user->function,
                'slug' => $this->user->slug,
            ],
            'server' => [
                'id' => $this->server['id'],
                'name' => $this->server['name'],
                'has_access' => $this->response,
            ],
        ];
    }

    /**
     * Get the notification's database type.
     */
    public function databaseType(object $notifiable): string
    {
        return 'ServerAccessResponse';
    }

    /**
     * Get the mail representation of the notification.
     *
     * @param  mixed  $notifiable
     * @return \Illuminate\Notifications\Messages\MailMessage
     */
    public function toMail($notifiable)
    {
        // todo: customize email
        // return (new Mailable($notifiable, 'confirmation-email',
        //     array('tokenLink' => '<a href="'.$this->urlToken.'">Confirmer mon email</a>')))
        //     ->to($notifiable->email);
    }

    /**
     * Get the type of the notification being broadcast.
     */
    public function broadcastType(): string
    {
        return 'broadcast.message';
    }

    /**
     * Get the broadcastable representation of the notification.
     */
    public function toBroadcast(object $notifiable): BroadcastMessage
    {
        return new BroadcastMessage([
            'message' => 'New access response on server',
        ]);
    }
}
