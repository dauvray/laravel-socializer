<?php

namespace Dauvray\Socializer\app\Helpers;

use Innovation\formdesigner\app\Helpers\QuestionnaireHelper;
use Dauvray\Socializer\app\Models\DynAnswerMongo;

class SocializerQuestionnaireHelper extends QuestionnaireHelper
{
    public function __construct($questionnaire_id = null, $formable = null, $answer_id = null, $standalone = false)
    {
        parent::__construct($questionnaire_id, $formable, $answer_id, $standalone, true);   
        
        // Associate mongo collection
        define('CURRENT_SERVER', $this->questionnaire->extras['collection']);
        $this->collection = DynAnswerMongo::class; 

        $this->BuildQuestionnaire();
    }
}