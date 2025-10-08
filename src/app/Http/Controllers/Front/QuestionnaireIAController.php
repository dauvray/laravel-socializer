<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Dauvray\Socializer\app\Services\QuestionnaireIA as QuestionnaireIAService;

class QuestionnaireIAController extends Controller
{
    public function createIAQuestionnaire(Request $request, QuestionnaireIAService $service)
    {
        return $service->createIAQuestionnaire($request->all());
    }

}