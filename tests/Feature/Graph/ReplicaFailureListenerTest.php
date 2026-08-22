<?php

namespace Dauvray\Socializer\Tests\Feature\Graph;

use Dauvray\Estarter\app\Events\GroupUserCreated;
use Dauvray\Estarter\app\Events\GroupUserDeleted;
use Dauvray\Socializer\app\Listeners\GroupUserCreatedListener;
use Dauvray\Socializer\app\Listeners\GroupUserDeletedListener;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\Test;

/**
 * E7 — un échec d'écriture sur le réplica se journalise, et ne fait pas échouer l'opération hôte.
 *
 * `GroupUserCreatedListener` / `GroupUserDeletedListener` sont la SEULE propagation MariaDB →
 * NebulaGraph de l'appartenance à un groupe. Ils appelaient `insertEdge` / `deleteEdge` sans
 * `$result =`, sans test, sans `try`. Un échec d'écriture était donc parfaitement muet : pas
 * d'arête, pas de log, pas d'exception. L'admin voyait « utilisateur ajouté ✅ », et le membre ne
 * pouvait pas rejoindre le canal de son groupe — sans que rien, nulle part, ne l'explique.
 *
 * LES DEUX MOITIÉS DU CONTRAT, et elles se contredisent en apparence :
 *
 *   - l'échec doit être BRUYANT — c'est tout l'objet d'E7 ;
 *   - il ne doit PAS faire échouer l'opération hôte. MySQL est la source de vérité, le graphe est
 *     un réplica, et aucun de ces listeners n'implémente `ShouldQueue` : ils tournent dans la
 *     requête HTTP de l'hôte. Laisser remonter l'exception ferait échouer l'attachement d'un
 *     utilisateur à un groupe parce qu'une COPIE n'a pas pu être écrite.
 *
 * La dérive que ce compromis laisse s'installer — un réplica qui diverge de MySQL — est le sujet
 * d'E4.2, que ce lot débloque : arbitrer la re-synchronisation d'un réplica dont les écritures
 * pouvaient échouer en silence n'avait pas de sens.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. La doublure ne parse pas le nGQL : « l'écriture échoue » est
 * un mode scripté, pas un refus de graphe. Ce qui est prouvé, c'est le CÂBLAGE du rattrapage —
 * que le listener n'explose pas, et qu'il laisse une trace exploitable.
 */
class ReplicaFailureListenerTest extends TestCase
{
    private function groupUser(int $userId = 7, int $groupId = 3): object
    {
        return (object) ['id' => 1, 'user_id' => $userId, 'group_id' => $groupId];
    }

    /*
    |--------------------------------------------------------------------------
    | 1. L'échec est rattrapé, et journalisé
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function une_arete_de_groupe_refusee_ne_fait_pas_echouer_l_attachement(): void
    {
        $this->fakeNebulaGraph()->throwsOn('INSERT EDGE');

        Log::spy();

        // Aucune exception ne doit traverser : c'est l'assertion, et elle est structurelle.
        (new GroupUserCreatedListener)->handle(new GroupUserCreated($this->groupUser()));

        Log::shouldHaveReceived('error')
            ->withArgs(fn (string $message, array $context) => ($context['listener'] ?? null) === GroupUserCreatedListener::class
                && ($context['user_id'] ?? null) === 7
                && ($context['group_id'] ?? null) === 3
                && ($context['code'] ?? null) === -1004)
            ->once();
    }

    #[Test]
    public function un_retrait_d_arete_refuse_ne_fait_pas_echouer_le_detachement(): void
    {
        $this->fakeNebulaGraph()->throwsOn('DELETE EDGE');

        Log::spy();

        (new GroupUserDeletedListener)->handle(new GroupUserDeleted($this->groupUser()));

        Log::shouldHaveReceived('error')
            ->withArgs(fn (string $message, array $context) => ($context['listener'] ?? null) === GroupUserDeletedListener::class
                && ($context['user_id'] ?? null) === 7)
            ->once();
    }

    /*
    |--------------------------------------------------------------------------
    | 2. Le chemin nominal ne journalise rien, et écrit bien
    |--------------------------------------------------------------------------
    */

    /**
     * Le garde-fou de non-régression : sans lui, un `catch` trop large qui avalerait TOUT — y
     * compris un succès mal interprété — passerait inaperçu.
     */
    #[Test]
    public function une_arete_de_groupe_ecrite_ne_journalise_rien(): void
    {
        $graph = $this->fakeNebulaGraph();

        Log::spy();

        (new GroupUserCreatedListener)->handle(new GroupUserCreated($this->groupUser()));

        Log::shouldNotHaveReceived('error');

        $this->assertNotEmpty($graph->queries(), 'Aucune arête n\'est partie sur le chemin nominal.');
        $this->assertStringContainsString('INSERT EDGE', $graph->queries()[0]);
    }
}
