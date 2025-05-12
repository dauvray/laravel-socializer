<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Dauvray\Socializer\app\Services\ApplicationIA as ApplicationIAService;

class ApplicationIAController extends Controller
{
    public function saveApplicationIA(Request $request, ApplicationIAService $service)
    {
        return $service->saveApplicationIA($request);
    }

    public function loadApplicationIA(Request $request, ApplicationIAService $service)
    {
        return $service->loadApplicationIA($request);
    }

    public function databaseAction(Request $request, ApplicationIAService $service)
    {
        return response()->json($service->databaseAction($request), 200);
    }
}