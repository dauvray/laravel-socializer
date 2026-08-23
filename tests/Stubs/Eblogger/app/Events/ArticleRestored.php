<?php

namespace Dauvray\Eblogger\app\Events;

/**
 * Doublure de l'événement d'eblogger — cf. `ArticleCreated` et `ArticleDeleted` juste à côté.
 *
 * ⚠️ En production il part sur `static::restored` (`Article::booted`), le pendant du `deleting`
 * d'`ArticleDeleted` : les deux encadrent le cycle du soft delete. Son seul abonné côté eblogger est
 * un `handle()` vide (`// task to do`) — c'est `ArticleRestoredListener` de CE paquet qui repose le
 * sommet.
 */
class ArticleRestored
{
    public function __construct(public mixed $article) {}
}
