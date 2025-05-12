<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Dauvray\Socializer\app\Services\Likes as LikesService;

class LikeController extends Controller
{
    public function submitLike(Request $request, LikesService $service)
    {
        // todo 
        // if (!\Config('estarter.allow_likes')) {
        //     abort(403);
        // }

        $request->validate([
            'isLiked' => 'required',
            'vertexid' => 'required'
        ]);

        return response()->json(
            $service->createLike(
                $request->get('isLiked'), 
                $request->get('vertexid'), 
                $request->get('storeid'),
                $request->get('type')
            ), 
            200
        );
    }
}