<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Dauvray\Socializer\app\Events\FeedActivity;
use Dauvray\Socializer\app\Services\Feed as FeedService;
use Illuminate\Support\Facades\Auth;

class FeedController extends Controller
{
    public function getOwnerFeed(FeedService $service, $identifier)
    {
        $user = revealIdentifier($identifier);

        $feed = $service->getFeed($user->vertexid, 'feed');

        return response()->json($feed, 200);
    }

    public function getOwnerWall(FeedService $service, $identifier)
    {
        $user = revealIdentifier($identifier);

        $feed = $service->getFeed($user->vertexid, 'wall');

        return response()->json($feed, 200);
    }

    // sert a avertir le feed qu'il y a de l'activité dessus ( nouveau commentaire, like ...)
    public function triggerFeedActivity(Request $request, FeedService $service)
    {
        FeedActivity::dispatch($request->all());
    }

    public function getFeedPosts(FeedService $service, $feed_id = null) 
    {
        // todo protection du feed
       $posts =  $service->getFeedPosts($feed_id);
     
       return response()->json($posts, 200);
    }

    public function sendFeedPost(Request $request, FeedService $service)
    {
        $post = $service->sendFeedPost($request);

        if($post) {
            return response()->json($post, 200);
        }
        
        return response()->json(['message' => 'Impossible de publier le post'], 500);
    }

    public function deleteFeedPost(Request $request, FeedService $service)
    {
        return $service->deleteFeedPost($request);
    }

    public function shareFeedPost(Request $request, FeedService $service)
    {
       return $service->shareFeedPost($request);
    }

    public function feedSubscribeAlert(Request $request, FeedService $service)
    {
        return $service->feedSubscribeAlert($request);
    }


/*-------------------
 WIP alerts
---------------------*/
    public function testQuery()
    {
        $answer = config('formdesigner.models.answer_mongo')::first();
        $alerts = config('socializer.models.alert')::where('questionnaire_id', 4)->get();

        foreach ($alerts as $alert) {
        
            if ($this->matchesSearch($answer->model, $alert->search)) {
                // Déclenche une alerte pour cet utilisateur
               // notifyUser($alert->user_id, $answer);
               dd($alert);
            }
        }
    }

    public function matchesSearch(array $model, array $search): bool
    {
        foreach ($search as $key => $values) {
            if (!array_key_exists($key, $model)) {
                return false; // La clé n'existe pas dans le modèle
            }

            $modelValue = $model[$key];

            // Vérifier les types pour différentes structures
            if (is_array($values)) {
                if (is_array($modelValue)) {
                    // Si les deux sont des tableaux, vérifier l'intersection
                    if (empty(array_intersect($values, $modelValue))) {
                        return false; // Pas de correspondance dans le tableau
                    }
                } else {
                    // Si `modelValue` est une valeur unique, vérifier si elle est dans `values`
                    if (!in_array($modelValue, $values)) {
                        return false;
                    }
                }
            } elseif ($modelValue !== $values) {
                return false; // Correspondance stricte pour les valeurs scalaires
            }
        }

        return true; // Toutes les conditions sont satisfaites
    }
}