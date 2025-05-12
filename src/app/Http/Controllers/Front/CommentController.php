<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Dauvray\Socializer\app\Services\Comments as CommentService;

class CommentController extends Controller
{
    /**
     * Submit comment
     *
     * @return \Illuminate\Http\Response
     */
    public function submitComment(Request $request, CommentService $service)
    {
        if (!\Config('estarter.allow_comments')) {
            abort(403);
        }

        $request->validate([
            'comment' => 'required',
            'commentable' => 'required'
        ]);

        $commentable = revealIdentifier($request->commentable);

        if(!$commentable->is_commentable) {
            abort(403);
        }

        return $service->createCommment($request->get('comment'), $commentable->vertexid);
    }

    public function submitSubComment(Request $request, CommentService $service)
    {
        if (!\Config('estarter.allow_comments')) {
            abort(403);
        }

        $request->validate([
            'comment' => 'required',
            'commentable' => 'required'
        ]);

        $resource = $service->createCommment($request->get('comment'), $request->commentable);
      //  $service->notifyCommentReplyOfAuthor($request->commentable, $resource);

        return response()->json($resource, 200);
    }

    public function getComments(Request $request, CommentService $service)
    {       
        $commentable = revealIdentifier($request->commentable);

        if(!$commentable->is_commentable) {
            abort(403);
        }

        $comments = $service->loadComments(
            $commentable->vertexId, 
            strtolower(getClassNameFromNamespace($commentable)), 
            'comments.get',
            $request->get('order')
        );

        return $comments;
    }

    public function getSubComments(Request $request, CommentService $service)
    {       
        $commentable = $request->get('commentable');

        return $service->loadComments(
            $commentable, 
            'comment', 
            'subcomments.get'
        );
    }

    public function deleteComment(Request $request, CommentService $service)
    {        
        return $service->deleteComment($request->comment_id, $request->commentable);
    }

    public function getTotalComments(Request $request)
    {
        $item = revealIdentifier($request->get('commentable'));
        if(!$item) {
            return response()->json(['message' => 'Elément introuvale'], 404);
        }
        return response()->json($item->nb_comments, 200);
    }
}
