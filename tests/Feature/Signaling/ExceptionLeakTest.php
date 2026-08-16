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
     * ⚠️ Ces payloads doivent rester VALIDES au sens de C4 : depuis la validation des
     * payloads relayés, un `peerId` bidon ou un `options` vide part en 422 — donc bien
     * avant le `Broadcast::private` dont ce fichier teste l'échec. Le test resterait vert
     * pour la mauvaise raison, en n'exerçant plus rien.
     *
     * @return array<string, array{0: string, 1: array<string, mixed>}>
     */
    public static function signalingRoutes(): array
    {
        $peerId = '550e8400-e29b-41d4-a716-446655440000';
        $options = ['type' => 'visio', 'action' => 'peer-access-permission', 'peerId' => $peerId];

        return [
            'askForPeerId' => ['/ask-to-peer-id', ['room' => 'r1', 'type' => 'stream']],
            'responseToPeerId' => ['/response-to-peer-id', ['room' => 'r1', 'type' => 'stream', 'peerId' => $peerId]],
            'responseToPeerAuthorization' => ['/response-to-authorization-peer', ['status' => true, 'options' => $options]],
            'closeConnectionToPeerId' => ['/close-connection-to-peer-id', ['room' => 'r1', 'type' => 'stream']],
            'sendAlertToUser' => ['/send-alert-to-user', ['options' => $options]],
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

        // ⚠️ `json_encode` échappe les `/` en `\/` : chercher `/var/www/…` dans le corps JSON
        // brut ne peut JAMAIS matcher, quel que soit ce qu'il contient réellement. Ce test ne
        // fonctionnait que contre la forme ORIGINALE du bug de C3 — un `return $ex;` rendu en
        // texte brut par `Response::setContent`. Depuis que le corps est du JSON, l'assertion
        // sur le chemin était vide de sens : trouvé en contre-épreuve d'E5, en faisant
        // volontairement fuiter `$ex->getMessage()` dans la réponse — ces cinq cas sont restés
        // verts. On déséchappe donc avant de chercher.
        $body = str_replace('\\/', '/', $response->getContent());

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
    public function la_reponse_500_porte_un_message_sans_rien_divulguer(): void
    {
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        Broadcast::shouldReceive('private')
            ->andThrow(new \RuntimeException('Connexion Reverb refusée dans '.self::LEAKY_PATH));

        $response = $this->actingAs($alice)->postJson('/ask-to-peer-id', [
            'toUserSlug' => $bob->slug,
            'room' => 'r1',
            'type' => 'stream',
        ])->assertStatus(500);

        // Une panne muette reste une panne : `AjaxService` d'estarter émet `httpError` sur un
        // 500 comme sur un 403, et sans `message` dans le corps l'utilisateur reçoit un
        // `AWN.alert(null)` — un cadre vide au lieu d'une raison.
        $message = $response->json('message');

        $this->assertIsString($message, "L'échec doit porter un message : sinon le toast part vide.");
        $this->assertNotSame('', trim($message));

        // Et ce message est une constante statique : il ne PEUT pas transporter la panne.
        // C'est la moitié qui compte — rendre l'échec lisible sans rouvrir la fuite de C3.
        $this->assertStringNotContainsString('Reverb', $message);
        $this->assertStringNotContainsString(self::LEAKY_PATH, $message);
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
