<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Dauvray\Socializer\app\Services\Store as StoreService;

class StoreController extends Controller
{
    public function getApplications(Request $request, StoreService $service)
    {
        return response()->json($service->getApplications($request->route()->getName()), 200);
    }

}