<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use App\Http\Controllers\Controller;
use App\Models\User;
use Dauvray\Socializer\app\Http\Resources\User as UserResource;
use Dauvray\Socializer\app\Services\Users as UserService;

class WallController extends Controller
{
    public function getWallOwner(UserService $service, $slug) {

        $user = User::firstWhere('slug', $slug);
        $userNebula = $service->getGraphUser($user);

        $resource = array_merge($user->toArray(), $userNebula, ['vertexid' => $user->vertexId, 'connected' => $user->connected]);

        if(!$user) {
            abort(404);
        }

        return response()->json(new UserResource((object)$resource), 200);
    }
}