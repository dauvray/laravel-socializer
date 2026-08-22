<?php

namespace Dauvray\Eblogger\app\Events;

/**
 * Doublure de l'événement d'eblogger, absent du harnais.
 *
 * Même raison et même forme que `Estarter\...\GroupUserCreated` : `eblogger` est un paquet
 * OPTIONNEL que le `composer.json` d'ici ne déclare pas, alors que deux listeners du paquet sont
 * typés sur ses événements. Elle NE LÈVE PAS — un événement est un porteur de données, pas un
 * comportement, et le reproduire à l'identique ne peut mentir sur rien.
 *
 * Seule la forme lue par le listener est reproduite : `$event->article`
 * (`src/app/Listeners/ArticleCreatedListener.php`).
 */
class ArticleCreated
{
    public function __construct(public mixed $article) {}
}
