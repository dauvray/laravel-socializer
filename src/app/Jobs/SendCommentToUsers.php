<?php
 
namespace Dauvray\Socializer\app\Jobs;
 
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Dauvray\Socializer\app\Events\CommentCreated;
 
class SendCommentToUsers implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
 
    /**
     * Create a new job instance.
     */
    public function __construct(
        public $resource,
        public $feed_id,
    ) {}
 
    /**
     * Execute the job.
     */
    public function handle(): void
    {
        CommentCreated::dispatch($this->resource, $this->feed_id);
    }
}