<?php
 
namespace Dauvray\Socializer\app\Jobs;
 
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Dauvray\Socializer\app\Events\PostCreatedEvent;

class SendPostToFollowers implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
 
    /**
     * Create a new job instance.
     */
    public function __construct(
        public $resource,
        public $feed_id,
        public $author_id,
    ) {}
 
    /**
     * Execute the job.
     */
    public function handle(): void
    {
        // send to users present on the feed
        event(new PostCreatedEvent($this->resource, $this->feed_id));

        // send to followers
        $feed_followers = getFeedFollowers($this->feed_id);
        foreach($feed_followers as $feed) {

            try {
               
                $feed_destination = $feed['feed_dest']['id'];

                // publish post on feed follower
                setPublishedInRelation($this->resource->resource['post']['vertexid'], $feed_destination);

                // broadcast new post to feed follower if connected
                $follower_id = str_replace('user', '', $feed['user']['id']);
                $is_connected = app('onlineUsers')->isOnlineUser($follower_id);
                if($is_connected) {
                    $is_feed_active = app('onlineUsers')->hasUserItem('feed', $feed_destination, $follower_id); 
                    if($is_feed_active) {
                          event(new PostCreatedEvent($this->resource, $feed_destination));
                    }
                }
            } catch (\Exception $e) {
                continue; // skip if conversion fails
            }
        }
    }
}