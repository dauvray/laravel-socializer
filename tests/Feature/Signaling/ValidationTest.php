<?php

namespace Dauvray\Socializer\Tests\Feature\Signaling;

use Dauvray\Socializer\app\Http\Controllers\Front\UserController;
use Dauvray\Socializer\Tests\Stubs\User;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Arr;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

/**
 * C4 — validation des payloads relayés par les 5 routes de signalisation.
 *
 * Aucune de ces routes ne regardait ce qu'elle transmettait : `room`, `type`,
 * `connectionType`, `peerId` et surtout `options` partaient bruts dans le
 * `Broadcast::private(...)` reçu par la victime. `options` est le cas le plus large — c'est
 * le seul champ relayé VERBATIM, donc un objet de forme et de taille libres poussé chez
 * quelqu'un d'autre.
 *
 * ⚠️ LE RISQUE DE CETTE TÂCHE EST LA SÉVÉRITÉ, PAS LA PERMISSIVITÉ. Un 422 sur
 * `/ask-to-peer-id` ou `/response-to-peer-id` reproduit « A diffuse, B arrive, B ne voit
 * rien » — le symptôme que ce chantier a déjà combattu deux fois. D'où l'ordre des cas
 * ci-dessous : le nominal des 5 routes d'abord, et des payloads copiés sur ce que
 * `usePeerCore` envoie réellement, jamais sur une intuition de forme.
 *
 * Les deux nullables qui ne sont pas des oublis :
 *  - `connectionType` — le module WebRTC v1 (mort mais encore présent) ne l'envoie pas, et
 *    le repli `connectionType || type` est un choix documenté de rétrocompatibilité ;
 *  - `options.action` sur la route de RÉPONSE — un refus d'appel n'envoie que `{ type }`.
 */
class ValidationTest extends TestCase
{
    // `signalingRoutes()` (fournisseur de données) et `nominalPayload()`, partagés avec
    // `RelationGuardTest`.
    use SignalingPayloads;

    protected function setUp(): void
    {
        parent::setUp();

        // Tout le fichier repose sur « un refus n'émet rien » : sans interception, un
        // broadcast parti malgré un 422 passerait inaperçu.
        $this->fakeBroadcasts();
    }

    /** Chemin du champ « type » d'une route : au premier niveau, ou dans `options`. */
    private function typeField(string $uri): string
    {
        return in_array($uri, ['/send-alert-to-user', '/response-to-authorization-peer'], true)
            ? 'options.type'
            : 'type';
    }

    private function corrupt(array $payload, string $field, mixed $value): array
    {
        Arr::set($payload, $field, $value);

        return $payload;
    }

    /*
    |--------------------------------------------------------------------------
    | 1. Le nominal passe — le cas qui compte le plus
    |--------------------------------------------------------------------------
    */

    #[Test]
    #[DataProvider('signalingRoutes')]
    public function le_payload_nominal_passe_et_diffuse(string $uri, string $event): void
    {
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $response = $this->actingAs($alice)
            ->postJson($uri, $this->nominalPayload($uri, $bob, $alice));

        $response->assertOk();

        // `fromUserSlug` reste l'authentifié : la validation n'a pas touché l'invariant.
        $this->assertBroadcastSent($bob, $event, function (array $payload) use ($alice) {
            return $payload['fromUserSlug'] === $alice->slug;
        });
    }

    #[Test]
    public function le_refus_d_appel_ne_porte_que_le_type(): void
    {
        // `sendAuthorizationRemotePeerId` : « on envoie les infos de connexion seulement si
        // l'accès est autorisé, sinon on précise juste le type ». Exiger `options.action`
        // des deux côtés casserait ce chemin — c'est la raison d'être du paramètre
        // `actionRequired` d'`optionsRules()`.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/response-to-authorization-peer', [
            'toUserSlug' => $bob->slug,
            'status' => false,
            'options' => ['type' => 'visio'],
        ])->assertOk();

        $this->assertBroadcastSent($bob, 'ResponseToAuthorizationPeer');
    }

    #[Test]
    public function connection_type_absent_reste_accepte(): void
    {
        // Le module v1 ne l'envoie pas et le client se replie sur `type`. Le rendre requis
        // couperait la signalisation de ces appelants-là.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/ask-to-peer-id', [
            'toUserSlug' => $bob->slug,
            'room' => 'app',
            'type' => 'stream',
        ])->assertOk();

        $this->assertBroadcastSent($bob, 'AskToPeerID', function (array $payload) {
            return $payload['connectionType'] === null;
        });
    }

    #[Test]
    #[DataProvider('peerIdRoutes')]
    public function l_etat_de_diffusion_absent_est_relaye_a_false(string $uri, string $event): void
    {
        // Même raison que `connectionType`, en plus dure : ce champ est né après les
        // routes, donc tout bundle antérieur au déploiement ne l'envoie pas — et un 422
        // ici reproduit exactement « A diffuse, B arrive, B ne voit rien ». Absent doit
        // arriver `false` et non `null` : le client n'a pas de troisième état à traiter.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $payload = $this->nominalPayload($uri, $bob, $alice);
        unset($payload['isBroadcasting']);

        $this->actingAs($alice)->postJson($uri, $payload)->assertOk();

        $this->assertBroadcastSent($bob, $event, function (array $payload) {
            return $payload['isBroadcasting'] === false;
        });
    }

    #[Test]
    #[DataProvider('peerIdRoutes')]
    public function l_etat_de_diffusion_annonce_est_relaye(string $uri, string $event): void
    {
        // Le fait qui ferme la fenêtre d'attente perçue chez l'arrivant : c'est ce champ,
        // et lui seul, qui lui apprend qu'un flux vient avant tout contact P2P.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)
            ->postJson($uri, $this->nominalPayload($uri, $bob, $alice))
            ->assertOk();

        $this->assertBroadcastSent($bob, $event, function (array $payload) {
            return $payload['isBroadcasting'] === true;
        });
    }

    #[Test]
    public function un_etat_de_diffusion_non_booleen_est_refuse(): void
    {
        // La chaîne "true" est le piège : `boolean` accepte 1/0/"1"/"0" mais PAS "true".
        // Un client qui sérialiserait ce champ en chaîne casserait donc la signalisation
        // entière plutôt que la seule vignette d'attente — d'où le test.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/ask-to-peer-id', $this->corrupt(
            $this->nominalPayload('/ask-to-peer-id', $bob, $alice),
            'isBroadcasting',
            'true',
        ))->assertStatus(422);

        $this->assertNoBroadcastSent();
    }

    /**
     * Les deux routes qui portent l'état de diffusion.
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function peerIdRoutes(): array
    {
        return [
            'askForPeerId' => ['/ask-to-peer-id', 'AskToPeerID'],
            'responseToPeerId' => ['/response-to-peer-id', 'ResponseToPeerID'],
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | 2 à 6. Ce qui est refusé — et qui n'émet rien
    |--------------------------------------------------------------------------
    */

    #[Test]
    #[DataProvider('signalingRoutes')]
    public function un_type_hors_liste_blanche_est_refuse(string $uri, string $event): void
    {
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $payload = $this->corrupt(
            $this->nominalPayload($uri, $bob, $alice),
            $this->typeField($uri),
            'exfiltration',
        );

        $this->actingAs($alice)->postJson($uri, $payload)->assertStatus(422);

        // Un refus qui laisserait partir le broadcast n'en serait pas un.
        $this->assertNoBroadcastSent();
    }

    #[Test]
    public function un_peer_id_qui_n_est_pas_un_uuid_est_refuse(): void
    {
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/response-to-peer-id', [
            'toUserSlug' => $bob->slug,
            'peerId' => '../../../etc/passwd',
            'room' => 'app',
            'type' => 'stream',
        ])->assertStatus(422);

        $this->assertNoBroadcastSent();
    }

    #[Test]
    public function un_peer_id_forge_dans_les_options_est_refuse(): void
    {
        // Même matière première, autre porte : `options.peerId` est ce qu'`acceptCallFromPeer`
        // enregistre comme mapping vérifié de l'initiateur.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/send-alert-to-user', [
            'toUserSlug' => $bob->slug,
            'options' => [
                'type' => 'visio',
                'action' => 'peer-access-permission',
                'peerId' => 'pas-un-uuid',
            ],
        ])->assertStatus(422);

        $this->assertNoBroadcastSent();
    }

    #[Test]
    public function une_action_d_invitation_inconnue_est_refusee(): void
    {
        // `AlertComponent.vue` fait `mappingComponents[options.action][options.type]` sans
        // garde : une action inconnue y lève un TypeError chez le destinataire.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/send-alert-to-user', [
            'toUserSlug' => $bob->slug,
            'options' => ['type' => 'visio', 'action' => 'peer-access-denied'],
        ])->assertStatus(422);

        $this->assertNoBroadcastSent();
    }

    #[Test]
    #[DataProvider('signalingRoutes')]
    public function un_slug_de_destinataire_malforme_est_refuse_avant_la_recherche_en_base(
        string $uri,
        string $event,
    ): void {
        // Le discriminant est le CODE : validation d'abord ⇒ 422 ; `firstOrFail()` d'abord
        // ⇒ 404, et le slug arbitraire aurait touché la base. C'est la marche sur laquelle
        // C2 (contrôle de relation) et E3 (fin de l'énumération) viendront se poser.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $payload = $this->corrupt(
            $this->nominalPayload($uri, $bob, $alice),
            'toUserSlug',
            "bob' OR 1=1 --",
        );

        $this->actingAs($alice)->postJson($uri, $payload)->assertStatus(422);

        $this->assertNoBroadcastSent();
    }

    #[Test]
    public function une_room_hors_borne_est_refusee(): void
    {
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/ask-to-peer-id', [
            'toUserSlug' => $bob->slug,
            'room' => str_repeat('r', 101),
            'type' => 'stream',
        ])->assertStatus(422);

        $this->assertNoBroadcastSent();
    }

    /*
    |--------------------------------------------------------------------------
    | 7. La liste blanche d'`options`
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function les_cles_inconnues_d_options_ne_sont_pas_relayees(): void
    {
        // `options` est le seul champ transmis verbatim : sans réduction aux clés attendues,
        // un émetteur y pousse ce qu'il veut, de la taille qu'il veut, chez la victime.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->actingAs($alice)->postJson('/send-alert-to-user', [
            'toUserSlug' => $bob->slug,
            'options' => [
                'type' => 'visio',
                'action' => 'peer-access-permission',
                'peerId' => self::PEER_ID,
                'charge' => str_repeat('x', 5000),
                'onclick' => 'alert(1)',
            ],
        ])->assertOk();

        $this->assertBroadcastSent($bob, 'AlertToUser', function (array $payload) {
            $this->assertSame(
                ['type', 'action', 'peerId'],
                array_keys($payload['options']),
                'Une clé non listée dans RELAYED_OPTION_KEYS a été relayée.',
            );

            return true;
        });
    }

    /*
    |--------------------------------------------------------------------------
    | 8. Non-régression C3 : un 422 ne doit pas devenir un 500
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function une_erreur_de_validation_ne_tombe_pas_dans_le_handler_d_echec(): void
    {
        // `ValidationException` étend `\Exception` : un `validate()` posé DANS le `try` de
        // C3 serait avalé par `signalingFailure()` et ressortirait en 500 `{"ok":false}` —
        // le client croirait à une panne serveur, et la cause réelle serait invisible.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $response = $this->actingAs($alice)->postJson('/ask-to-peer-id', [
            'toUserSlug' => $bob->slug,
            'room' => 'app',
            'type' => 'exfiltration',
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('type');
    }

    /*
    |--------------------------------------------------------------------------
    | 9. Le miroir JS ↔ PHP
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function la_liste_blanche_php_reflete_le_front(): void
    {
        // Deux sources de vérité pour une même règle, dans deux langages : rien dans le
        // build ne les rapproche. Ce test est le seul lien — il relit le fichier JS. Sans
        // lui, ajouter un type côté client produirait un 422 en production, et la cause
        // serait à chercher dans un autre dépôt mental.
        $config = file_get_contents(__DIR__.'/../../../src/resources/js/socializer/components/WebRTC2/webrtc2.config.js');

        $this->assertIsString($config, 'webrtc2.config.js est introuvable — chemin à corriger.');

        preg_match('/VALID_CONNECTION_TYPES\s*=\s*new Set\(\[(.*?)\]\)/s', $config, $types);
        preg_match_all("/'([^']+)'/", $types[1] ?? '', $quoted);

        $reflection = new \ReflectionClass(UserController::class);

        $this->assertSame(
            $quoted[1],
            $reflection->getConstant('VALID_CONNECTION_TYPES'),
            'VALID_CONNECTION_TYPES a divergé entre webrtc2.config.js et UserController.',
        );

        preg_match('/SLUG_PATTERN\s*=\s*(\S+)\s*$/m', $config, $slug);

        $this->assertSame(
            $slug[1] ?? null,
            $reflection->getConstant('SLUG_PATTERN'),
            'SLUG_PATTERN a divergé entre webrtc2.config.js et UserController.',
        );
    }
}
