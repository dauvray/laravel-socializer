<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Auth;

class QuestionnaireIA
{
    private $user;

    public function __construct()
    {
       $this->user = Auth::user();
    }

    public function createIAQuestionnaire($payload = null)
    {
        if(!$payload) {
            return false;
        }

        Http::post(config('socializer.agents_ai.n8n.create_questionnaire_webhook'), [
            'prompt' => $payload['prompt'],
            'prompt_id' => $payload['prompt_id'],
            'user_id' => $this->user->id,
            'action' => $payload['action'],
            'groups' => $payload['groups'] ?? [],
            'sessionID' => session()->getId(),
        ]);
    }

    public function receiveGroupsQuestionnaire($payload = null)
    {
        if(isset($payload['output']) && is_array($payload['output']) && isset($payload['prompt_id']) && isset($payload['user_id'])) {
            broadcastEventbusNotification($payload['user_id'], $payload);
        }
    }
}