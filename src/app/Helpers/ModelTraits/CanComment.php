<?php

namespace Dauvray\Socializer\app\Helpers\ModelTraits;

use Dauvray\Eblogger\app\Models\Comment;

trait CanComment
{
    /**
     * @param $commentable
     * @param string $commentText
     * @param int $rate
     * @return $this
     */

    // public function comment($commentable, $commentText = '', $parent_id = null)
    // {
    //     $comment = new Comment([
    //         'content'        => $commentText,
    //         'approved'       => ($commentable->mustBeApproved && !$this->isAdmin()) ? 0 : 1,
    //         'commented_id'   => $this->id,
    //         'commented_type' => get_class(),
    //         'commentable_id' => $commentable->id,
    //         'commentable_type' => get_class($commentable),
    //         'parent_id' => $parent_id
    //     ]);

    //    return $commentable->comments()->save($comment);
    // }


    /**
     * @return bool TODO
     */

    // public function isAdmin()
    // {
    //     return false;
    // }


    /**
     * @return \Illuminate\Database\Eloquent\Relations\MorphMany
     */

    // public function comments()
    // {
    //     return $this->morphMany(Comment::class, 'commented');
    // }

    /*
    |--------------------------------------------------------------------------
    | ACCESORS
    |--------------------------------------------------------------------------
    */

    public function getVertexIdAttribute()
    {
        return getVertexId($this);
    }
}
