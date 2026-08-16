<?php

namespace Dauvray\Socializer\Tests\Feature\Signaling;

use Dauvray\Socializer\Tests\Stubs\User;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Broadcasting\AnonymousEvent;
use Illuminate\Support\Facades\Event;
use PHPUnit\Framework\Attributes\Test;

/**
 * C1 — plafonds serveur sur les routes de signalisation WebRTC.
 *
 * Le seul limiteur qui existait vivait côté client (`ASK_PEER_MAX_REQUESTS_PER_WINDOW`, 3 par
 * 10 s **par cible**) : un anti-spam involontaire, qu'un attaquant retire de son bundle en une
 * ligne. Chaque requête relayée déclenche un `Broadcast::private(...)->sendNow()` vers la victime.
 *
 * DEUX BUCKETS, parce que les 5 routes n'ont pas la même cadence légitime :
 *
 *  - `socializer-signaling` (ask / response / close) doit encaisser la rafale de join d'une room
 *    mesh — 14 demandes dans le MÊME tick (7 pairs × type principal + écran, cf.
 *    MAX_PEERS_PER_ROOM) ;
 *  - `socializer-call-invite` (send-alert / response-authorization) est déclenché par un clic
 *    humain et coûte ~9 requêtes / 55 s vers UNE cible (backoff de `utils/usePeerRetry.js`).
 *
 * Un bucket unique dimensionné pour le join laisserait donc passer ~120 invitations d'appel par
 * minute vers une victime — c'est-à-dire qu'il ne fermerait PAS l'abus que C1 nomme. Les cas
 * `l_invitation_est_plafonnee_par_cible` et `les_deux_buckets_sont_independants` épinglent
 * précisément cette séparation.
 *
 * ⚠️ Les plafonds sont lus dans `config('socializer.signaling.throttle.*')` À CHAQUE REQUÊTE :
 * c'est ce qui permet à ces tests de les rétrécir au lieu d'émettre 121 requêtes HTTP. Un seul
 * test — `la_rafale_de_join_ne_declenche_aucun_429` — exerce les valeurs réelles de la config,
 * et c'est lui le garde-fou contre un dimensionnement trop bas.
 */
class ThrottleTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Les broadcasts sont interceptés : on veut compter ce qui est parti, et surtout
        // vérifier qu'un 429 n'émet RIEN (le throttle coupe avant le contrôleur).
        $this->fakeBroadcasts();
    }

    /*
    |--------------------------------------------------------------------------
    | Helpers
    |--------------------------------------------------------------------------
    */

    private function setThrottle(string $key, int $value): void
    {
        $this->app['config']->set('socializer.signaling.throttle.'.$key, $value);
    }

    /**
     * Une demande de peerId — le chemin le plus chaud du bucket mesh.
     */
    private function askPeerId(User $from, User $to): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($from)->postJson('/ask-to-peer-id', [
            'toUserSlug' => $to->slug,
            'room' => 'r1',
            'type' => 'stream',
        ]);
    }

    /**
     * Une invitation d'appel — le chemin que le limiteur par cible protège.
     */
    private function sendCallInvite(User $from, User $to): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($from)->postJson('/send-alert-to-user', [
            'toUserSlug' => $to->slug,
            'options' => ['type' => 'visio', 'action' => 'peer-access-permission'],
        ]);
    }

    /*
    |--------------------------------------------------------------------------
    | Bucket mesh
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function la_rafale_de_join_ne_declenche_aucun_429(): void
    {
        // ⚠️ Plafonds PAR DÉFAUT, volontairement : ce test est le garde-fou du
        // dimensionnement. Un join de room mesh émet légitimement 14 demandes dans le même
        // tick ; un plafond calé en dessous reproduirait « A diffuse, B arrive, B ne voit
        // rien », le symptôme que ce chantier a déjà combattu deux fois.
        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        for ($i = 0; $i < 14; $i++) {
            $this->askPeerId($alice, $bob)->assertOk();
        }

        Event::assertDispatchedTimes(AnonymousEvent::class, 14);
    }

    #[Test]
    public function le_plafond_mesh_repond_429_au_dela(): void
    {
        $this->setThrottle('mesh_per_minute', 3);

        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->askPeerId($alice, $bob)->assertOk();
        $this->askPeerId($alice, $bob)->assertOk();
        $this->askPeerId($alice, $bob)->assertOk();

        $this->askPeerId($alice, $bob)->assertStatus(429);

        // Un refus qui laisserait partir le broadcast n'en serait pas un : le throttle
        // s'exécute AVANT le contrôleur, donc la victime ne reçoit rien de plus.
        Event::assertDispatchedTimes(AnonymousEvent::class, 3);
    }

    #[Test]
    public function le_compteur_est_par_utilisateur(): void
    {
        // La clé est l'identifiant de l'émetteur, jamais l'IP : dans le harnais comme derrière
        // un NAT d'entreprise, tout le monde partage l'adresse. Une clé IP ferait que le join
        // d'un collègue casse celui du voisin.
        $this->setThrottle('mesh_per_minute', 2);

        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');
        $charlie = $this->makeUser('charlie');

        $this->askPeerId($alice, $charlie)->assertOk();
        $this->askPeerId($alice, $charlie)->assertOk();
        $this->askPeerId($alice, $charlie)->assertStatus(429);

        $this->askPeerId($bob, $charlie)->assertOk();
    }

    /*
    |--------------------------------------------------------------------------
    | Bucket invitation d'appel
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function l_invitation_est_plafonnee_par_cible(): void
    {
        // LE cas qu'un bucket unique ne verrait pas : le plafond porte sur le couple
        // (émetteur, cible), donc saturer bob ne doit rien retirer à charlie.
        $this->setThrottle('invite_per_target_per_minute', 3);
        $this->setThrottle('invite_per_minute', 100);

        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');
        $charlie = $this->makeUser('charlie');

        $this->sendCallInvite($alice, $bob)->assertOk();
        $this->sendCallInvite($alice, $bob)->assertOk();
        $this->sendCallInvite($alice, $bob)->assertOk();

        $this->sendCallInvite($alice, $bob)->assertStatus(429);

        $this->sendCallInvite($alice, $charlie)->assertOk();
    }

    #[Test]
    public function le_plafond_global_borne_le_spam_multi_cibles(): void
    {
        // Sans cette seconde limite, la limite par cible se contourne en arrosant N victimes.
        $this->setThrottle('invite_per_target_per_minute', 100);
        $this->setThrottle('invite_per_minute', 3);

        $alice = $this->makeUser('alice');
        $victimes = [
            $this->makeUser('bob'),
            $this->makeUser('charlie'),
            $this->makeUser('dave'),
            $this->makeUser('erin'),
        ];

        $this->sendCallInvite($alice, $victimes[0])->assertOk();
        $this->sendCallInvite($alice, $victimes[1])->assertOk();
        $this->sendCallInvite($alice, $victimes[2])->assertOk();

        $this->sendCallInvite($alice, $victimes[3])->assertStatus(429);
    }

    #[Test]
    public function la_reponse_d_autorisation_partage_le_bucket_invitation(): void
    {
        // Accepter/refuser est le pendant de l'invitation : même cadence légitime (1 par
        // invitation reçue), donc même bucket. La laisser dehors rouvrirait le spam par
        // l'autre bout du même échange.
        $this->setThrottle('invite_per_target_per_minute', 2);

        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->sendCallInvite($alice, $bob)->assertOk();

        $answer = fn () => $this->actingAs($alice)->postJson('/response-to-authorization-peer', [
            'toUserSlug' => $bob->slug,
            'status' => true,
            'options' => ['type' => 'visio'],
        ]);

        $answer()->assertOk();
        $answer()->assertStatus(429);
    }

    /*
    |--------------------------------------------------------------------------
    | Séparation des deux buckets
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function les_deux_buckets_sont_independants(): void
    {
        // Rouge si les 5 routes repassent un jour sous un seul nom de limiteur : la rafale de
        // join mangerait alors le budget d'invitation, et inversement un plafond dimensionné
        // pour le join laisserait le spam d'invitations passer.
        $this->setThrottle('mesh_per_minute', 2);

        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->askPeerId($alice, $bob)->assertOk();
        $this->askPeerId($alice, $bob)->assertOk();
        $this->askPeerId($alice, $bob)->assertStatus(429);

        $this->sendCallInvite($alice, $bob)->assertOk();
    }

    #[Test]
    public function les_trois_routes_mesh_partagent_le_meme_bucket(): void
    {
        // Elles décrivent le même flux (demander / répondre / clore) et se déclenchent
        // ensemble au join comme à la sortie : un budget commun, pas trois.
        $this->setThrottle('mesh_per_minute', 3);

        $alice = $this->makeUser('alice');
        $bob = $this->makeUser('bob');

        $this->askPeerId($alice, $bob)->assertOk();

        // ⚠️ Un vrai UUID, pas un 'p1' : depuis C4 un peerId non-UUID part en 422, et ce
        // test ne mesurerait plus la consommation du bucket qu'il vise.
        $this->actingAs($alice)->postJson('/response-to-peer-id', [
            'toUserSlug' => $bob->slug,
            'room' => 'r1',
            'type' => 'stream',
            'peerId' => '550e8400-e29b-41d4-a716-446655440000',
        ])->assertOk();

        $this->actingAs($alice)->postJson('/close-connection-to-peer-id', [
            'toUserSlug' => $bob->slug,
            'fromUserSlug' => $alice->slug,
            'room' => 'r1',
            'type' => 'stream',
        ])->assertOk();

        $this->askPeerId($alice, $bob)->assertStatus(429);
    }
}
