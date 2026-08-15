<?php

namespace Dauvray\Socializer\Tests\Feature\Signaling;

use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

/**
 * C3 — les 5 routes de signalisation ne doivent plus renvoyer l'objet exception.
 *
 * `catch (\Exception $ex) { return $ex; }` n'est pas anodin : le routeur ne sait pas quoi
 * faire d'un objet quelconque, alors il le passe à `Response::setContent`, qui accepte tout
 * ce qui est `__toString()`-able. Or `Throwable::__toString()` rend le message, LE CHEMIN DU
 * FICHIER, la ligne et LA TRACE COMPLÈTE. Le tout en **200**, et indépendamment d'`APP_DEBUG`
 * (d'où `APP_DEBUG=true` dans phpunit.xml : le mode debug ne doit rien changer au verdict).
 */
class ExceptionLeakTest extends TestCase
{
    /**
     * Message d'exception calqué sur ce qu'une vraie panne de broadcast produit : un chemin
     * absolu, qui est exactement ce qu'on ne veut pas voir sortir.
     */
    private const LEAKY_PATH = '/var/www/estarter-test/vendor/dauvray/laravel-socializer/src/secret.php';

    /**
     * @return array<string, array{0: string, 1: array<string, mixed>}>
     */
    public static function signalingRoutes(): array
    {
        return [
            'askForPeerId' => ['/ask-to-peer-id', ['room' => 'r1', 'type' => 'stream']],
            'responseToPeerId' => ['/response-to-peer-id', ['room' => 'r1', 'type' => 'stream', 'peerId' => 'p1']],
            'responseToPeerAuthorization' => ['/response-to-authorization-peer', ['status' => true, 'options' => []]],
            'closeConnectionToPeerId' => ['/close-connection-to-peer-id', ['room' => 'r1', 'type' => 'stream']],
            'sendAlertToUser' => ['/send-alert-to-user', ['options' => []]],
        ];
    }

    #[Test]
    #[DataProvider('signalingRoutes')]
    public function la_reponse_ne_contient_ni_chemin_ni_trace_quand_le_broadcast_echoue(
        string $uri,
        array $payload,
    ): void {
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        Broadcast::shouldReceive('private')
            ->andThrow(new \RuntimeException('Connexion Reverb refusée dans '.self::LEAKY_PATH));

        $response = $this->actingAs($alice)
            ->postJson($uri, array_merge(['toUserSlug' => $bob->slug], $payload));

        $body = $response->getContent();

        $this->assertStringNotContainsString(
            self::LEAKY_PATH,
            $body,
            "Le chemin du fichier fuit dans la réponse de $uri.",
        );
        $this->assertStringNotContainsString(
            '#0 ',
            $body,
            "La trace d'appel fuit dans la réponse de $uri.",
        );
        $this->assertStringNotContainsString(
            'RuntimeException',
            $body,
            "La classe d'exception fuit dans la réponse de $uri.",
        );

        // 200 sur une panne serait pire qu'un simple bavardage : le client croit avoir signalé.
        $response->assertStatus(500);
    }

    #[Test]
    public function l_echec_est_journalise_avec_de_quoi_diagnostiquer(): void
    {
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        Log::spy();

        Broadcast::shouldReceive('private')
            ->andThrow(new \RuntimeException('Connexion Reverb refusée dans '.self::LEAKY_PATH));

        $this->actingAs($alice)->postJson('/ask-to-peer-id', [
            'toUserSlug' => $bob->slug,
            'room' => 'r1',
            'type' => 'stream',
        ]);

        // Ce que la réponse ne dit plus, les logs doivent le dire — sinon on a troqué une
        // fuite contre une panne muette.
        Log::shouldHaveReceived('error')
            ->withArgs(function (string $message, array $context) use ($alice, $bob) {
                return $context['target_slug'] === $bob->slug
                    && $context['auth_user_id'] === $alice->id
                    && isset($context['exception']);
            })
            ->once();
    }

    #[Test]
    public function le_chemin_nominal_est_inchange(): void
    {
        // Non-régression : le succès ne renvoie toujours rien (200 vide). Le front lit le
        // statut, pas le corps — changer ça déborderait de C3.
        $this->fakeBroadcasts();

        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $response = $this->actingAs($alice)->postJson('/ask-to-peer-id', [
            'toUserSlug' => $bob->slug,
            'room' => 'r1',
            'type' => 'stream',
        ]);

        $response->assertOk();
        $this->assertBroadcastSent($bob, 'AskToPeerID', function (array $payload) use ($alice) {
            return $payload['fromUserSlug'] === $alice->slug && $payload['room'] === 'r1';
        });
    }
}
