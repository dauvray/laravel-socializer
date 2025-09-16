<?php
 
namespace Dauvray\Socializer\app\Jobs;
 
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use \App\Models\User;

 
class SendMessageToCopywriter implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $message;
    public $page;
    public User $user;

 
    /**
     * Create a new job instance.
     */
    public function __construct($message, $page, User $user) {
        $this->message = $message;
        $this->page = $page;
        $this->user = $user;
    }
 
    /**
     * Execute the job.
     */
    public function handle(): void
    {    
        $chatbot = config('estarter.models.user')::find($this->page['bot_id']); 

        Http::post($chatbot->extras['webhook_url'], [
            'assistantPrompt' => $chatbot->extras['prompt'] ?? '',
            'chatInput' => $this->message,
            'author' => ['name' => $this->user->name, 'id' => $this->user->id],
            'document' => $this->page,

        ]);
    }
}