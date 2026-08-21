<?php

namespace Dauvray\Socializer\Tests\Feature\Chat;

use Dauvray\Socializer\app\Services\Chat as ChatService;
use Dauvray\Socializer\Tests\Stubs\FakeNebulaGraph;
use Dauvray\Socializer\Tests\Stubs\FakeOnlineUsers;
use Dauvray\Socializer\Tests\Stubs\User;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\Test;

/**
 * E4.1 — aucun chemin d'écriture n'inscrit dans un chat qu'on n'a pas le droit de rejoindre.
 *
 * C'est la moitié du correctif sans laquelle l'autre ne ferme rien. `checkRegistration`, appelée
 * par `/send-chat-message` et `/send-chat-audio`, inscrivait son appelant dans N'IMPORTE QUEL
 * chat qu'il nommait, sans aucune garde : un seul POST, et l'attaquant devenait un membre
 * LÉGITIME — `canJoinchatRoom` répondait alors `true` à bon droit, et l'abonnement au canal privé
 * suivait, de façon permanente. **Un garde n'est fermé que quand tous les chemins qui écrivent
 * son état le sont aussi.**
 *
 * Le pendant nominal est `registerInRoomChat` : le chat d'un salon hérite de la décision de son
 * salon. Sans elle, fermer `checkRegistration` verrouillerait tout chat de salon pour quiconque
 * ne l'a pas créé — `getOrcreateChatVertice` n'inscrit que dans sa branche de création.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. `FakeNebulaGraph` fait du `str_contains`, il ne PARSE pas
 * le nGQL : « le chat est public », « je suis déjà inscrit » et « le salon m'admet » sont ici des
 * réponses scriptées, pas des faits de graphe. Ce qui est prouvé, c'est le câblage : quel garde
 * est consulté, dans quel ordre, et si l'arête part ou non.
 *
 * ⚠️ Les tests visent `checkRegistration` et `registerInRoomChat` directement, jamais
 * `getOrcreateChatVertice` : celle-ci finit par `getConversation()`, qui lit les messages et
 * pagine — injouable sous Testbench, où aucune table de chat n'existe.
 */
class ChatRegistrationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // `Chat::__construct` résout `app('onlineUsers')`, binding d'estarter : sans doublure,
        // le service n'est même pas constructible.
        $this->app->instance('onlineUsers', new FakeOnlineUsers);
    }

    /**
     * L'ordre compte : `Chat::__construct` capture `Auth::user()` une fois pour toutes.
     *
     * @return array{0: User, 1: ChatService}
     */
    private function actingUserAndService(string $name = 'alice'): array
    {
        $user = $this->makeUser($name);
        $this->actingAs($user);

        return [$user, new ChatService];
    }

    private function grapheMuet(): JsonResponse
    {
        return response()->json(['code' => -1005, 'message' => 'SemanticError'], 500);
    }

    /**
     * Les écritures d'arête passent par `insertEdge`, que la doublure relaie vers `execute` —
     * c'est ce qui les rend observables ici.
     *
     * @return array<int, string>
     */
    private function inscriptions(FakeNebulaGraph $graph): array
    {
        return array_values(array_filter(
            $graph->queries(),
            fn (string $query) => str_contains($query, 'INSERT EDGE')
        ));
    }

    /*
    |--------------------------------------------------------------------------
    | 1. `checkRegistration` — le contournement
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function un_chat_prive_dont_on_n_est_pas_membre_n_inscrit_personne(): void
    {
        $graph = $this->fakeNebulaGraph()
            ->when('OVER registered_in', [])   // pas encore inscrit
            ->when('c.chat.privacy', []);      // et le chat ne l'admet pas

        [, $service] = $this->actingUserAndService();

        $this->assertFalse($service->checkRegistration('chat42'));

        $this->assertSame(
            [],
            $this->inscriptions($graph),
            'Une inscription est partie : le garde du canal se contourne par un seul POST.'
        );
    }

    /**
     * Le garde-fou de non-régression : c'est lui qui rougit si on ferme trop.
     *
     * Sur un chat public, l'inscription à la volée est le comportement VOULU — c'est ainsi qu'on
     * apparaît dans la liste des participants d'un salon ouvert.
     */
    #[Test]
    public function un_chat_public_inscrit_toujours_a_la_volee(): void
    {
        $graph = $this->fakeNebulaGraph()
            ->when('OVER registered_in', [])
            // `privacy == 0` : le graphe remonte un inscrit quelconque, pas forcément moi.
            ->when('c.chat.privacy', ['userzoe']);

        [, $service] = $this->actingUserAndService();

        $this->assertTrue($service->checkRegistration('chat42'));

        $inscriptions = $this->inscriptions($graph);

        $this->assertCount(1, $inscriptions);
        $this->assertStringContainsString('useralice->chat42', $inscriptions[0]);
    }

    /**
     * Épingle l'ORDRE des branches : le cas « déjà inscrit » court-circuite le garde.
     *
     * Sans ce court-circuit, chaque message envoyé paierait un aller-retour Thrift de plus — sur
     * le chemin le plus chaud du chat.
     */
    #[Test]
    public function un_membre_deja_inscrit_ne_repaie_ni_le_garde_ni_l_arete(): void
    {
        $graph = $this->fakeNebulaGraph()->when('OVER registered_in', ['chat42']);

        [, $service] = $this->actingUserAndService();

        $this->assertTrue($service->checkRegistration('chat42'));

        $this->assertSame([], $this->inscriptions($graph));
        $this->assertEmpty(array_filter(
            $graph->queries(),
            fn (string $query) => str_contains($query, 'c.chat.privacy')
        ), 'Le garde a été consulté alors que l\'appelant était déjà inscrit.');
    }

    /**
     * Le fail-open propre à cette méthode : `execute()` rend un `JsonResponse` truthy sur panne,
     * donc `!$is_registred` était faux et le code concluait « déjà inscrit » sans rien écrire.
     */
    #[Test]
    public function un_graphe_muet_n_inscrit_pas_et_le_dit(): void
    {
        $graph = $this->fakeNebulaGraph()->always($this->grapheMuet());

        [, $service] = $this->actingUserAndService();

        Log::spy();

        $this->assertFalse($service->checkRegistration('chat42'));
        $this->assertSame([], $this->inscriptions($graph));

        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context) {
                return ($context['chat_vertexid'] ?? null) === 'chat42'
                    && array_key_exists('user_vertexid', $context);
            })
            // Un seul warning, et c'est la preuve du court-circuit : si la première branche ne
            // rendait pas la main, `canJoinchatRoom` en journaliserait un second.
            ->once();
    }

    /*
    |--------------------------------------------------------------------------
    | 2. `registerInRoomChat` — le chat hérite de la décision du salon
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function le_salon_qui_admet_fait_inscrire_dans_son_chat(): void
    {
        $graph = $this->fakeNebulaGraph()->when('r.room.privacy', ['useralice']);

        [, $service] = $this->actingUserAndService();

        $this->assertTrue($service->registerInRoomChat('room42', 'chat42'));

        $inscriptions = $this->inscriptions($graph);

        $this->assertCount(1, $inscriptions);
        $this->assertStringContainsString('useralice->chat42', $inscriptions[0]);
    }

    /**
     * Le garde délégué est celui du canal `room.{roomId}` — `canJoinRoom() || isCreator()`.
     * `always([])` fait répondre non aux deux.
     */
    #[Test]
    public function le_salon_qui_refuse_n_inscrit_pas_dans_son_chat(): void
    {
        $graph = $this->fakeNebulaGraph()->always([]);

        [, $service] = $this->actingUserAndService();

        $this->assertFalse($service->registerInRoomChat('room42', 'chat42'));

        $this->assertSame([], $this->inscriptions($graph));
    }
}
