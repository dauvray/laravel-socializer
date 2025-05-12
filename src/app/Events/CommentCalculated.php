<?php

namespace Dauvray\Socializer\app\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Queue\SerializesModels;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;

class CommentCalculated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $count;
    public $vertexid;
    public $storeid;

    /**
     * Create a new event instance.
     *
     * @return void
     */
    public function __construct($count, $vertexid, $storeid)
    {
        $this->count = $count;
        $this->storeid = $storeid;
        $this->vertexid = $vertexid;    

        $this->dontBroadcastToCurrentUser();
    }

    /**
     * Get the channel the event should broadcast on.
     */
    public function broadcastOn(): Channel
    {
        return new Channel($this->storeid.'.comment');
    }

}
