<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use Illuminate\Support\Facades\Auth;
use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Broadcast;
use Dauvray\Socializer\app\Http\Resources\User as UserResource;
use Dauvray\Socializer\app\Services\Users as UserService;

class UserController extends Controller
{
    public function getUserData(Request $request, $user_id = null)
    { 
        $user = Auth::user();

        if($user_id && $user->can('list_users')) {
            return response()->json([
                'user' => new UserResource( config('estarter.models.user')::findOrFail($user_id) )
            ]);
        }

        return response()->json(['user' => new UserResource($user)]);
    }

    public function getUsersList(Request $request, UserService $service)
    {
        $user = Auth::user();

        // if(!$user->can('list_users')) {
        //     return response()->json(['message' => 'Vous n\'avez pas la permission de lister les utilisateurs'], 403);
        // }

        return response()->json( $service->getUsersList($request->route()->getName()), 200);
    }

    public function followUser(Request $request, UserService $service)
    {
        $user_tofollow = revealIdentifier($request->get('identifier'));

        if($service->followUser($user_tofollow)) {
            return response()->json(['message' => 'Vous suivez maintenant '.$user_tofollow->name, 'status' => 'success'], 200);
        } else {
            return response()->json(['message' => 'Opération impossible', 'status' => 'error'], 500);
        }
    }

    public function unfollowUser(Request $request, UserService $service)
    {
        $user_followed = revealIdentifier($request->get('identifier'));

        if($service->unfollowUser($user_followed)) {
            return response()->json(['message' => 'Vous ne suivez plus '.$user_followed->name, 'status' => 'success'] , 200);
        } else {
            return response()->json(['message' => 'Opération impossible', 'status' => 'error'], 500);
        }

    }

    public function updateAvatar(Request $request)
    {
        $user = Auth::user();
        $user->image = $request->file('file');
        $user->save();
        return response()->json($user->image, 200);
    }

    public function updateCover(Request $request)
    {
        $user = Auth::user();
        $user->setCoverImage($request->file('file'));
        $user->save();
        return response()->json($user->extras['cover'], 200);
    }
    
    /*-----------------------------------------------
    | SIGNALING
    _________________________________________________*/

    /*
    | Ask PeerId to an user
    */
    public function askForPeerId(Request $request)
    {
        $to = config('estarter.models.user')::where('slug', $request->get('toUserSlug'))->firstOrFail();
        $user = Auth::user();

        try {
            Broadcast::private('App.Models.User.'.$to->id)
            ->as('AskToPeerID')
            ->with([
                'peerId' => $request->get('peerId'),
                'room' => $request->get('room'),
                'type' => $request->get('type'),
                'fromUserSlug' => $user->slug,
            ])
            ->sendNow();
        }
        catch (\Exception $ex) {
           return $ex;
        }
    }

    /*
    | Return peer id to user who asked it
    */
    public function responseToPeerId(Request $request)
    {
        $to = config('estarter.models.user')::where('slug', $request->get('toUserSlug'))->firstOrFail();
        $user = Auth::user();

        try {
            Broadcast::private('App.Models.User.'.$to->id)
            ->as('ResponseToPeerID')
            ->with([
                'peerId' => $request->get('peerId'),
                'fromUserSlug' => $user->slug,
                'type' => $request->get('type'),
                'room' => $request->get('room'),
            ])
            ->sendNow();
        }
        catch (\Exception $ex) {
           return $ex;
        }
    }

    public function responseToPeerAuthorization(Request $request)
    {
        $to = config('estarter.models.user')::where('slug', $request->get('toUserSlug'))->firstOrFail();
        $user = Auth::user();

        try {
            Broadcast::private('App.Models.User.'.$to->id)
            ->as('ResponseToAuthorizationPeer')
            ->with([
                'options' =>  $request->get('options'),
                'status' => $request->get('status'),
                'fromUserSlug' => $user->slug,
            ])
            ->sendNow();
        }
        catch (\Exception $ex) {
           return $ex;
        }
    }

    public function closeConnectionToPeerId(Request $request)
    {
        $to = config('estarter.models.user')::where('slug', $request->get('toUserSlug'))->firstOrFail();

        try {
            Broadcast::private('App.Models.User.'.$to->id)
            ->as('CloseConnectionToPeerID')
            ->with([
                'fromUserSlug' => $request->get('fromUserSlug'),
                'room' => $request->get('room'),
                'type' => $request->get('type'),
            ])
            ->sendNow();
        }
        catch (\Exception $ex) {
           return $ex;
        }
    }

    public function sendAlertToUser(Request $request) 
    {
        $to = config('estarter.models.user')::where('slug', $request->get('toUserSlug'))->firstOrFail();
        $user = Auth::user();

        try {
            Broadcast::private('App.Models.User.'.$to->id)
            ->as('AlertToUser')
            ->with([
                'options' =>  $request->get('options'),
                'fromUserSlug' => $user->slug,
            ])
            ->sendNow();
        }
        catch (\Exception $ex) {
           return $ex;
        }
    }
}