<?php

namespace Dauvray\Estarter\app\Events;

/**
 * Doublure de l'événement d'estarter, absent du harnais.
 *
 * ⚠️ Elle NE LÈVE PAS, contrairement aux autres doublures de la famille
 * (`Estarter\...\Thumbnails`, `Formdesigner\...\QuestionnaireHelper`). La règle « les doublures
 * lèvent » vise les doublures de COMPORTEMENT, dont le silence ferait passer un test au vert sans
 * qu'il exerce quoi que ce soit. Un événement ne porte aucun comportement : c'est un porteur de
 * données, et le reproduire à l'identique ne peut mentir sur rien.
 *
 * Seule la forme lue par les listeners du paquet est reproduite : `$event->group_user->user_id`
 * et `->group_id` (`src/app/Listeners/GroupUserDeletedListener.php:29`).
 */
class GroupUserDeleted
{
    public function __construct(public mixed $group_user) {}
}
