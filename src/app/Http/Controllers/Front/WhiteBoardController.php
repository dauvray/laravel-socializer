<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Dauvray\Socializer\app\Services\WhiteBoard as WhiteBoardService;

class WhiteBoardController extends Controller
{
    public function saveWhiteBoard(Request $request, WhiteBoardService $service)
    {
        $service->saveWhiteBoard($request);
    }

    public function loadWhiteBoard(Request $request, WhiteBoardService $service)
    {
        return $service->loadWhiteBoard($request);
    }
}