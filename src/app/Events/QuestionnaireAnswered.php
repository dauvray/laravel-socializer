<?php

namespace Dauvray\Socializer\app\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Queue\SerializesModels;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;

class QuestionnaireAnswered implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $model;
    public $vertexid;

    /**
     * Create a new event instance.
     *
     * @return void
     */
    public function __construct($model, $vertexid)
    {
        $this->model = $model;
        $this->vertexid = $vertexid;

        $this->dontBroadcastToCurrentUser();
    }

    /**
     * Get the channel the event should broadcast on.
     */
    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('questionnaire.'.$this->vertexid);
    }

    public function broadcastAs(): string
    {
        return 'questionnaireAnswers.updated';
    }
}
