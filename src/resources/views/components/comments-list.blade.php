<socializer-comments 
    :canbecommented="true" 
    :formvisible="false" 
    :nbcomments="{{ $nb_comments }}"
    commentable="{{ $commentable }}"
    :autoload="@json($autoload == 0 ? false : true)"
    :pagination="@json($pagination == 0 ? false : true)"
    vertexid="{{ revealIdentifier($commentable)->vertexid }}"
    class="blog-comments"
></socializer-comments>