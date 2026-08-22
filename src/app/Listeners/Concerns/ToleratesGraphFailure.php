<?php

namespace Dauvray\Socializer\app\Listeners\Concerns;

use Dauvray\Socializer\app\Exceptions\NebulaGraphException;
use Illuminate\Support\Facades\Log;

/**
 * Propage une écriture vers le réplica NebulaGraph sans faire échouer l'opération hôte.
 *
 * LE PROBLÈME QU'IL RÈGLE. Les onze listeners du paquet écrivaient dans le graphe sans jamais
 * regarder le résultat — `app('nebulaGraph')->insertEdge(…);`, pas de `$result =`, pas de test,
 * pas de `try`. Avant E7 la couture ne levait pas : un échec d'écriture était donc parfaitement
 * muet. Pas d'arête, pas de log, pas d'exception, et une interface qui affiche « ✅ ».
 *
 * POURQUOI RATTRAPER PLUTÔT QUE LAISSER REMONTER. Aucun de ces listeners n'implémente
 * `ShouldQueue` : ils s'exécutent dans la requête HTTP de l'application hôte, sur ses chemins les
 * plus sensibles — création de compte, attachement à un groupe, connexion. Or **MySQL est la
 * source de vérité et le graphe n'en est qu'un réplica** : faire échouer l'attachement d'un
 * utilisateur à un groupe parce qu'une COPIE n'a pas pu être écrite inverse le rapport entre les
 * deux. L'échec doit être bruyant dans le JOURNAL, pas dans la réponse HTTP.
 *
 * CE QU'IL NE RÈGLE PAS. La dérive qui s'installe quand une écriture échoue — un réplica qui
 * diverge de MySQL sans que personne ne le resynchronise — reste entière. C'est le sujet d'E4.2,
 * que ce lot débloque : arbitrer la re-synchronisation d'un réplica dont les écritures pouvaient
 * échouer en silence n'avait pas de sens.
 *
 * ⚠️ Ne rattrape QUE `NebulaGraphException`. Une `TypeError` ou un `BindingResolutionException`
 * dans la closure est un bug du listener, pas une panne de réplica : il doit remonter.
 */
trait ToleratesGraphFailure
{
    /**
     * @param  callable():mixed  $write  l'écriture à tenter
     * @param  array<string, mixed>  $context  de quoi retrouver la ligne MySQL à resynchroniser
     */
    protected function syncToGraph(callable $write, array $context = []): void
    {
        try {
            $write();
        } catch (NebulaGraphException $e) {
            Log::error(
                'Réplica NebulaGraph désynchronisé : l\'écriture a été refusée',
                $e->context() + $context + ['listener' => static::class]
            );
        }
    }
}
