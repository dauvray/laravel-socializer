<?php

namespace Dauvray\Eblogger\app\Events;

/**
 * Doublure de l'événement d'eblogger — cf. `ArticleCreated` juste à côté.
 *
 * ⚠️ En production il part sur `static::deleting` (`Article::booted`), donc sur un SOFT delete :
 * l'article existe encore en base quand le listener s'exécute. Rien à reproduire ici — le listener
 * ne lit que `$event->article->id` —, mais c'est ce qui rend l'absence d'`ArticleRestoredListener`
 * conséquente une fois la suppression effective (`work/projection-graphe-todo.md`).
 */
class ArticleDeleted
{
    public function __construct(public mixed $article) {}
}
