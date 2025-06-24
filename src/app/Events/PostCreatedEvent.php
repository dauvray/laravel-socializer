<?php

namespace Dauvray\Socializer\app\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Queue\SerializesModels;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;

class PostCreatedEvent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $post;
    public $vertexid;

    /**
     * Create a new event instance.
     *
     * @return void
     */
    public function __construct($post, $vertexid)
    {
        $this->post = $post;
        $this->vertexid = $vertexid;

        $this->dontBroadcastToCurrentUser();
    }

    /**
     * Get the channel the event should broadcast on.
     */
    public function broadcastOn(): Channel
    {
        return new Channel($this->vertexid.'.feed');
    }
}
