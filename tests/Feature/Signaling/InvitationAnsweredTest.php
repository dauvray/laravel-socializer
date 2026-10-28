<?php

namespace Dauvray\Socializer\Tests\Feature\Signaling;

use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Contracts\Broadcasting\Factory as BroadcastFactory;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

/**
 * « Décroché ailleurs » — la réponse à une invitation prévient aussi les AUTRES onglets du
 * répondant.
 *
 * `sendAlertToUser` diffuse l'invitation sur le canal privé de l'appelé, donc à tous ses onglets et
 * appareils ; la réponse, elle, ne partait que vers l'appelant. Les onglets qui n'avaient pas
 * répondu sonnaient jusqu'à leur auto-refus (10 s en visio, 20 s en vocal), qui atteignait
 * l'appelant en pleine conversation. `responseToPeerAuthorization` émet donc en plus
 * `InvitationAnswered` sur le canal du RÉPONDANT, et les onglets sœurs ferment l'alerte de cette
 * invitation sans répondre (`Notifications.vue`, `isAnsweredElsewhere`).
 *
 * Toute réponse ciblée, refus compris : chez l'appelant, l'une comme l'autre clôt l'invitation.
 *
 * Le garde de relation n'est pas répété ici : le payload nominal de `RelationGuardTest` porte un
 * `inviteId`, et ses refus assertent qu'AUCUN broadcast ne part, celui-ci compris.
 */
class InvitationAnsweredTest extends TestCase
{
    private const ROOM = '9b2f6c1e-5d4a-4e8b-a1c3-0f7e2d9b6a54';

    private const INVITE_ID = '3c8e1f2a-7b6d-4c5e-9f0a-1d2b3c4e5f60';

    private const PEER_ID = '550e8400-e29b-41d4-a716-446655440000';

    protected function setUp(): void
    {
        parent::setUp();

        $this->fakeBroadcasts();
    }

    #[Test]
    public function une_acceptation_previent_les_autres_onglets_du_repondant(): void
    {
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/response-to-authorization-peer', [
            'toUserSlug' => $bob->slug,
            'status' => true,
            'options' => [
                'type' => 'visio',
                'room' => self::ROOM,
                'peerId' => self::PEER_ID,
                'inviteId' => self::INVITE_ID,
            ],
        ])->assertOk();

        $this->assertBroadcastSent($bob, 'ResponseToAuthorizationPeer');

        // EXACTEMENT ces deux clés : ni `status`, ni `peerId`, ni `fromUserSlug` — les onglets
        // sœurs ferment l'alerte en silence, et l'auteur de ce signal en est le destinataire.
        $this->assertBroadcastSent($alice, 'InvitationAnswered', function (array $payload) use ($bob) {
            return $payload === ['inviteId' => self::INVITE_ID, 'callerSlug' => $bob->slug];
        });
        $this->assertBroadcastNotSent($bob, 'InvitationAnswered');
    }

    #[Test]
    public function un_refus_previent_aussi_les_autres_onglets(): void
    {
        // « Occupé ⇒ refus » et l'alerte introuvable passent par ce même chemin : une alerte sœur
        // qui sonne encore après un refus est morte, l'appelant a consommé l'invitation.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/response-to-authorization-peer', [
            'toUserSlug' => $bob->slug,
            'status' => false,
            'options' => ['type' => 'visio', 'room' => self::ROOM, 'inviteId' => self::INVITE_ID],
        ])->assertOk();

        $this->assertBroadcastSent($alice, 'InvitationAnswered', function (array $payload) use ($bob) {
            return $payload === ['inviteId' => self::INVITE_ID, 'callerSlug' => $bob->slug];
        });
    }

    /**
     * Les trois formes d'un `inviteId` manquant que la validation laisse passer (`nullable`).
     *
     * Le contrat épinglé est celui de bout en bout. La chaîne vide est convertie en `null` par
     * `ConvertEmptyStringsToNull` avant le contrôleur : ce cas ne discrimine PAS la clause `=== ''`
     * d'`announceInvitationAnswered`, qui ne sert qu'à l'hôte qui retirerait ce middleware.
     *
     * @return array<string, array{0: array<string, mixed>}>
     */
    public static function inviteIdManquant(): array
    {
        return [
            'absent' => [['type' => 'visio']],
            'null' => [['type' => 'visio', 'inviteId' => null]],
            'chaîne vide' => [['type' => 'visio', 'inviteId' => '']],
        ];
    }

    #[Test]
    #[DataProvider('inviteIdManquant')]
    public function une_reponse_sans_invite_id_ne_previent_personne_de_plus(array $options): void
    {
        // Bundle antérieur au 27/10/2026 : l'invitation ne se cible pas. La réponse à l'appelant,
        // elle, part comme avant. Côté client, c'est ce silence qui rend inutile toute garde sur
        // l'`inviteId` de l'annonce (`Notifications.vue`, `isAnsweredElsewhere`).
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/response-to-authorization-peer', [
            'toUserSlug' => $bob->slug,
            'status' => false,
            'options' => $options,
        ])->assertOk();

        $this->assertBroadcastSent($bob, 'ResponseToAuthorizationPeer');
        $this->assertBroadcastNotSent($alice, 'InvitationAnswered');
    }

    #[Test]
    public function un_echec_de_l_annonce_ne_fait_pas_echouer_la_reponse(): void
    {
        // La réponse à l'appelant est déjà partie (`sendNow()` est synchrone) : un 500 ferait
        // afficher par `AjaxService` un toast d'échec au répondant, dont la réponse a pourtant
        // abouti. L'échec se journalise, et les onglets sœurs retombent sur l'auto-refus, que
        // l'appelant ignore.
        //
        // ⚠️ Un proxy de l'INSTANCE réelle, discriminé par canal — pas `Broadcast::partialMock()`,
        // construit sans constructeur : `$this->app` y est null, et la route part en 500 pour une
        // tout autre raison (mesuré par la relecture du 28/10/2026).
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        Log::spy();

        $real = app(BroadcastFactory::class);
        $proxy = \Mockery::mock($real);
        $proxy->shouldReceive('private')
            ->with('App.Models.User.'.$bob->id)
            ->andReturnUsing(fn (string $channel) => $real->private($channel));
        $proxy->shouldReceive('private')
            ->with('App.Models.User.'.$alice->id)
            ->andThrow(new \RuntimeException('Reverb injoignable'));
        Broadcast::swap($proxy);

        $this->actingAs($alice)->postJson('/response-to-authorization-peer', [
            'toUserSlug' => $bob->slug,
            'status' => true,
            'options' => ['type' => 'visio', 'room' => self::ROOM, 'inviteId' => self::INVITE_ID],
        ])->assertOk();

        $this->assertBroadcastSent($bob, 'ResponseToAuthorizationPeer');

        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context) use ($alice, $bob) {
                return $context['auth_user_id'] === $alice->id
                    && $context['target_slug'] === $bob->slug
                    && isset($context['exception']);
            })
            ->once();
    }
}
