<?php

namespace Dauvray\Socializer\app\View\Components;

use Closure;
use Illuminate\Contracts\View\View;
use Illuminate\View\Component;

class CommentsList extends Component
{
    public $nb_comments = 0;

    /**
     * Create a new component instance.
     */
    public function __construct(
        public string $commentable,
        public string $autoload,
        public string $pagination,
    ) 
    {}

    /**
     * Whether the component should be rendered
     */
    public function shouldRender(): bool
    {
        return true;
    }

    /**
     * Get the view / contents that represent the component.
     */
    public function render(): View|Closure|string
    {
        if(!$this->autoload) {
            $element = revealIdentifier($this->commentable);
            $this->nb_comments = $element->nbComments;
        }
       
        return view('socializer::components.comments-list');
    }
}