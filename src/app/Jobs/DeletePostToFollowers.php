<?php
 
namespace Dauvray\Socializer\app\Jobs;
 
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Dauvray\Socializer\app\Events\PostDeleted;
 
class DeletePostToFollowers implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
 
    /**
     * Create a new job instance.
     */
    public function __construct(
        public $post_id,
        public $feed_id,
    ) {}
 
    /**
     * Execute the job.
     */
    public function handle(): void
    {
        PostDeleted::dispatch($this->post_id, $this->feed_id);
    }
}