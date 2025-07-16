<?php
 
namespace Dauvray\Socializer\app\Jobs;
 
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Dauvray\Socializer\app\Services\Chat as ChatService;
use \App\Models\User;

 
class SendMessageToBot implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $message;
    public $chat;
    public User $user;
 
    /**
     * Create a new job instance.
     */
    public function __construct($message, $chat, User $user) {
        $this->message = $message;
        $this->chat = $chat;
        $this->user = $user;
    }
 
    /**
     * Execute the job.
     */
    public function handle(): void
    {     
        $chatbot = config('estarter.models.user')::find($this->chat['bot_id']); 

        $botResponse = Http::post($chatbot->extras['webhook_url'], [
            'message' => $this->message->message_src,
            'author' => ['name' => $this->user->name, 'id' => $this->user->id],
            'room_id' => $this->chat['id'],
        ]);

        $response = $botResponse->json('message') ?? '...';


        $botMessage = [
            'chat_id' =>  $this->chat['id'],
            'message' => $response,
            'user' => $this->chat['bot_id'],
         ];

         $service = new ChatService();

         $service->sendMessage(null, $botMessage, true);
    }
}