<?php

namespace Dauvray\Socializer\app\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Queue\SerializesModels;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;

class ItemLiked implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $likes;
    public $vertexid;
    public $storeid;
    public $type;

    /**
     * Create a new event instance.
     *
     * @return void
     */
    public function __construct($likes, $vertexid, $storeid, $type = 'comment')
    {
        $this->likes = $likes;
        $this->vertexid = $vertexid;
        $this->storeid = $storeid;
        $this->type = $type;

        $this->dontBroadcastToCurrentUser();
    }

    /**
     * Get the channel the event should broadcast on.
     */
    public function broadcastOn(): Channel
    {
        return new Channel($this->storeid.'.'.$this->type);
    }
}
