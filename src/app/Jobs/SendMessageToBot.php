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
    public function handle(ChatService $service): void
    {     
        $chatbot = config('estarter.models.user')::find($this->chat['bot_id']); 

        Http::post($chatbot->extras['webhook_url'], [
            'assistantPrompt' => $chatbot->extras['prompt'] ?? '',
            'chatInput' => $this->message->message_src,
            'author' => ['name' => $this->user->name, 'id' => $this->user->id],
            'sessionId' => $this->chat['id'],
            'conversation' => $this->chat,
        ]);
    }
}