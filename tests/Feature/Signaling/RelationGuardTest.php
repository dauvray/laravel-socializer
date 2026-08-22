<?php

namespace Dauvray\Socializer\Tests\Feature\Signaling;

use Dauvray\Socializer\Tests\Stubs\FakeNebulaGraph;
use Dauvray\Socializer\Tests\Stubs\User;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

/**
 * C2 — les 5 routes de signalisation exigent une relation entre émetteur et destinataire.
 *
 * N'importe quel authentifié pouvait signaler n'importe quel utilisateur par son slug.
 * `mayReach` ferme ce trou : « même groupe MariaDB OU follow réciproque ». C'est le jumeau
 * SERVEUR du garde sortant `isAuthorizedPeer` du client, et la seule fermeture possible de
 * l'usurpation intra-room — côté navigateur, le cas nominal et l'attaque ont la même
 * signature locale, seul le backend peut trancher.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. `FakeNebulaGraph` fait du `str_contains` sur le nGQL,
 * il ne le PARSE pas. Les deux cas « follow » ci-dessous ne testent donc pas la réciprocité :
 * ils testent « le graphe a répondu vrai / faux ». Toute la sémantique de la jambe follow —
 * direction de l'arête `wall -> suiveur`, présence des DEUX sens — vit dans une requête que
 * le harnais ne sait pas évaluer, et une requête syntaxiquement invalide passerait ici au
 * vert. Elle se contre-vérifie contre un vrai NebulaGraph, pas ici.
 *
 * Ce que ce fichier prouve, en revanche : le câblage. Que le garde est posé sur les CINQ
 * routes, qu'il refuse AVANT d'émettre, qu'il ne distingue pas un slug inconnu d'une absence
 * de relation, qu'il refuse quand le graphe ne répond pas, et qu'il ne paie pas le graphe
 * quand le groupe a déjà tranché.
 */
class RelationGuardTest extends TestCase
{
    use SignalingPayloads;

    protected function setUp(): void
    {
        parent::setUp();

        // Tout ce fichier repose sur « un refus n'émet rien » : sans interception, un
        // broadcast parti malgré un 403 passerait inaperçu.
        $this->fakeBroadcasts();
    }

    /**
     * Deux inconnus : aucun groupe commun, et un graphe qui ne dira jamais oui.
     *
     * `groupId: null` est le point important — `makeUser` inscrit sinon tout le monde dans le
     * même groupe, ce qui rendrait ce fichier entièrement vert pour la mauvaise raison.
     *
     * @return array{0: User, 1: User}
     */
    private function makeStrangers(): array
    {
        return [
            $this->makeUser('alice', groupId: null),
            $this->makeUser('mallory', groupId: null),
        ];
    }

    private function signal(User $from, User $to, string $uri)
    {
        return $this->actingAs($from)->postJson($uri, $this->nominalPayload($uri, $to, $from));
    }

    /**
     * Un graphe qui répond vraiment — `[false]` ou `[true]`, et non le `[]` par défaut de la
     * doublure.
     *
     * La nuance n'est pas cosmétique. La requête de `followsMutually` finit par
     * `RETURN count(*) > 0`, un agrégat : un vrai NebulaGraph renvoie TOUJOURS exactement une
     * ligne, `false` quand rien ne correspond. Un tableau vide ne veut donc pas dire « pas de
     * follow », il veut dire « le graphe n'a pas répondu » — et `followsMutually` le
     * journalise comme tel. Confondre les deux, c'est écrire des tests d'absence de relation
     * qui vérifient en fait une panne.
     */
    private function fakeGraphAnswering(bool $mutual): FakeNebulaGraph
    {
        return $this->fakeNebulaGraph()->when('followed_by', [$mutual]);
    }

    /*
    |--------------------------------------------------------------------------
    | 1. Le refus — sur les cinq routes
    |--------------------------------------------------------------------------
    */

    #[Test]
    #[DataProvider('signalingRoutes')]
    public function deux_inconnus_ne_peuvent_pas_se_signaler(string $uri, string $event): void
    {
        $this->fakeGraphAnswering(false);

        [$alice, $mallory] = $this->makeStrangers();

        $this->signal($alice, $mallory, $uri)->assertStatus(403);

        // Un refus qui laisserait partir le broadcast n'en serait pas un : c'est le broadcast
        // qui porte l'attaque, pas le code de retour.
        $this->assertNoBroadcastSent();
    }

    #[Test]
    #[DataProvider('signalingRoutes')]
    public function un_follow_a_sens_unique_ne_suffit_pas(string $uri, string $event): void
    {
        // La requête de `followsMutually` exige les deux sens dans un seul MATCH : un follow
        // non réciproque n'y produit aucune ligne, donc `count(*) > 0` vaut false.
        $this->fakeGraphAnswering(false);

        [$alice, $mallory] = $this->makeStrangers();

        $this->signal($alice, $mallory, $uri)->assertStatus(403);
        $this->assertNoBroadcastSent();
    }

    #[Test]
    #[DataProvider('signalingRoutes')]
    public function des_groupes_differents_ne_suffisent_pas(string $uri, string $event): void
    {
        $this->fakeGraphAnswering(false);

        $alice = $this->makeUser('alice', groupId: 10);
        $mallory = $this->makeUser('mallory', groupId: 20);

        $this->signal($alice, $mallory, $uri)->assertStatus(403);
        $this->assertNoBroadcastSent();
    }

    /*
    |--------------------------------------------------------------------------
    | 2. Le laissez-passer — les deux jambes, sur les cinq routes
    |--------------------------------------------------------------------------
    */

    #[Test]
    #[DataProvider('signalingRoutes')]
    public function un_groupe_commun_autorise(string $uri, string $event): void
    {
        $this->fakeNebulaGraph();

        $alice = $this->makeUser('alice', groupId: 42);
        $bob = $this->makeUser('bob', groupId: 42);

        $this->signal($alice, $bob, $uri)->assertOk();

        $this->assertBroadcastSent($bob, $event, function (array $payload) use ($alice) {
            return $payload['fromUserSlug'] === $alice->slug;
        });
    }

    #[Test]
    #[DataProvider('signalingRoutes')]
    public function un_follow_reciproque_autorise(string $uri, string $event): void
    {
        $this->fakeGraphAnswering(true);

        [$alice, $bob] = [
            $this->makeUser('alice', groupId: null),
            $this->makeUser('bob', groupId: null),
        ];

        $this->signal($alice, $bob, $uri)->assertOk();

        $this->assertBroadcastSent($bob, $event, function (array $payload) use ($alice) {
            return $payload['fromUserSlug'] === $alice->slug;
        });
    }

    /*
    |--------------------------------------------------------------------------
    | 3. Les cas de bord du garde
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function un_slug_inexistant_repond_403_et_non_404(): void
    {
        $graph = $this->fakeNebulaGraph();

        $alice = $this->makeUser('alice', groupId: null);

        $this->actingAs($alice)->postJson('/ask-to-peer-id', [
            'toUserSlug' => 'personne-de-ce-nom',
            'room' => 'app',
            'type' => 'stream',
        ])->assertStatus(403);

        // Le cœur du cas : 404 et 403 doivent être indistinguables, sinon sonder des slugs
        // suffit à énumérer les comptes existants.
        $this->assertNoBroadcastSent();

        // Et le refus ne doit rien coûter : pas de destinataire ⇒ pas de prédicat.
        $this->assertSame([], $graph->queries());
    }

    #[Test]
    public function le_refus_porte_un_message_lisible(): void
    {
        $this->fakeGraphAnswering(false);

        [$alice, $mallory] = $this->makeStrangers();

        $response = $this->signal($alice, $mallory, '/ask-to-peer-id')->assertStatus(403);

        // Le corps de cette réponse est du TEXTE AFFICHÉ, pas seulement une donnée de
        // protocole : `AjaxService.load` d'estarter émet `httpError` sur un 403, et
        // `widgets/Alert.vue` appelle `AWN.alert(data.message || toaster.err)`. Les appels
        // WebRTC2 ne passant aucun `toaster`, un corps sans `message` produisait un
        // `AWN.alert(null)` — une alerte au contenu nul.
        $message = $response->json('message');

        $this->assertIsString($message, 'Le refus doit porter un message : sinon le toast part vide.');
        $this->assertNotSame('', trim($message));
    }

    #[Test]
    public function le_message_ne_distingue_pas_le_slug_inconnu_de_l_absence_de_relation(): void
    {
        // Un seul graphe pour les deux causes : la première ne l'interroge pas (pas de
        // destinataire ⇒ pas de prédicat), la seconde a besoin qu'il réponde vraiment non.
        $this->fakeGraphAnswering(false);

        [$alice, $mallory] = $this->makeStrangers();

        // Cause A — le destinataire n'existe pas.
        $slugInconnu = $this->actingAs($alice)->postJson('/ask-to-peer-id', [
            'toUserSlug' => 'personne-de-ce-nom',
            'room' => 'app',
            'type' => 'stream',
        ])->assertStatus(403);

        // Cause B — il existe, mais rien ne les lie.
        $sansRelation = $this->signal($alice, $mallory, '/ask-to-peer-id')->assertStatus(403);

        // L'oracle d'énumération refermé par C2 ne tenait qu'à l'unification du CODE de
        // retour ; un libellé qui divergerait le rouvrirait mot pour mot — sonder des slugs
        // suffirait de nouveau à distinguer les comptes existants. On compare le corps
        // ENTIER, pas seulement `message` : toute clé future ajoutée d'un seul côté serait un
        // oracle de plus.
        $this->assertSame($slugInconnu->json(), $sansRelation->json());
    }

    #[Test]
    public function un_utilisateur_peut_toujours_se_signaler_a_lui_meme(): void
    {
        $graph = $this->fakeNebulaGraph();

        // Sans groupe ni follow : c'est le court-circuit d'identité qui doit répondre, et lui
        // seul. Le multi-onglet d'un même compte est un cas réel de WebRTC2.
        $alice = $this->makeUser('alice', groupId: null);

        $this->signal($alice, $alice, '/ask-to-peer-id')->assertOk();

        $this->assertBroadcastSent($alice, 'AskToPeerID');
        $this->assertSame([], $graph->queries());
    }

    #[Test]
    public function un_groupe_commun_court_circuite_le_graphe(): void
    {
        $graph = $this->fakeNebulaGraph();

        $alice = $this->makeUser('alice', groupId: 42);
        $bob = $this->makeUser('bob', groupId: 42);

        $this->signal($alice, $bob, '/ask-to-peer-id')->assertOk();

        // La jambe SQL doit trancher seule. Si le graphe est interrogé ici, c'est que le `||`
        // a été remplacé par une évaluation des deux jambes — un aller-retour Thrift payé
        // pour rien, 14 fois par rafale de join.
        $this->assertSame([], $graph->queries());
    }

    #[Test]
    public function le_verdict_est_memorise_entre_deux_requetes(): void
    {
        $graph = $this->fakeGraphAnswering(true);

        $alice = $this->makeUser('alice', groupId: null);
        $bob = $this->makeUser('bob', groupId: null);

        $this->signal($alice, $bob, '/ask-to-peer-id')->assertOk();
        $this->signal($alice, $bob, '/ask-to-peer-id')->assertOk();

        // Une rafale de join émet 14 requêtes dans le même tick. Sans mémorisation, c'est 14
        // fois le prédicat — dont 14 allers-retours vers le graphe.
        $this->assertCount(1, $graph->queries());
    }

    #[Test]
    public function le_verdict_est_memorise_dans_les_deux_sens(): void
    {
        $graph = $this->fakeGraphAnswering(true);

        $alice = $this->makeUser('alice', groupId: null);
        $bob = $this->makeUser('bob', groupId: null);

        $this->signal($alice, $bob, '/ask-to-peer-id')->assertOk();
        // `mayReach` est symétrique : la réponse de bob doit réutiliser l'entrée d'alice, pas
        // en créer une seconde. C'est ce qui rend la clé de cache non ordonnée.
        $this->signal($bob, $alice, '/response-to-peer-id')->assertOk();

        $this->assertCount(1, $graph->queries());
    }

    /**
     * Les deux façons dont le graphe peut ne pas répondre — aucune ne lève.
     *
     * @return array<string, array{0: mixed}>
     */
    public static function reponsesInexploitables(): array
    {
        return [
            // Ce que fait VRAIMENT `NebulaGraphConnection::responseJson` sur une erreur nGQL :
            // il RETOURNE un JsonResponse. Un objet, donc truthy — un `if($result)` naïf
            // lirait « oui » dans une panne.
            'JsonResponse d\'erreur' => [null],
            // Et le cas silencieux : `RETURN count(*) > 0` est un agrégat, un vrai graphe
            // renvoie toujours une ligne. Zéro ligne n'est donc pas « pas de follow », c'est
            // une réponse qu'on ne sait pas lire.
            'aucune ligne' => [[]],
        ];
    }

    #[Test]
    #[DataProvider('reponsesInexploitables')]
    public function un_graphe_muet_refuse_au_lieu_de_planter(mixed $reponse): void
    {
        // `response()` a besoin de l'application : impossible dans un fournisseur statique,
        // d'où le `null` sentinelle résolu ici, par le `grapheMuet()` du `TestCase`.
        $this->fakeNebulaGraph()->always($reponse ?? $this->grapheMuet());

        [$alice, $mallory] = $this->makeStrangers();

        $this->signal($alice, $mallory, '/ask-to-peer-id')->assertStatus(403);
        $this->assertNoBroadcastSent();
    }

    #[Test]
    public function le_refus_est_journalise_avec_de_quoi_tracer(): void
    {
        // Un graphe qui RÉPOND non, pour que le seul `warning` du test soit celui du refus.
        $this->fakeGraphAnswering(false);

        [$alice, $mallory] = $this->makeStrangers();

        Log::spy();

        $this->signal($alice, $mallory, '/ask-to-peer-id')->assertStatus(403);

        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context) use ($alice, $mallory) {
                return ($context['auth_user_id'] ?? null) === $alice->id
                    && ($context['target_slug'] ?? null) === $mallory->slug
                    // La distinction que la réponse HTTP tait, le journal la garde.
                    && ($context['target_exists'] ?? null) === true
                    && array_key_exists('ip', $context)
                    && array_key_exists('user_agent', $context);
            })
            ->once();
    }

    #[Test]
    public function le_garde_precede_le_journal_d_usurpation(): void
    {
        $this->fakeGraphAnswering(false);

        [$alice, $mallory] = $this->makeStrangers();

        Log::spy();

        // `closeConnectionToPeerId` journalise une tentative d'usurpation quand le
        // `fromUserSlug` déclaré n'est pas celui de l'authentifié. Ce journal ne doit pas
        // s'armer sur une requête déjà refusée : un refus est un refus, pas deux alertes.
        $this->actingAs($alice)->postJson('/close-connection-to-peer-id', [
            'toUserSlug' => $mallory->slug,
            'fromUserSlug' => 'quelqun-dautre',
            'room' => 'app',
            'type' => 'visio',
        ])->assertStatus(403);

        Log::shouldNotHaveReceived('warning', [
            \Mockery::pattern('/usurpation/'),
            \Mockery::any(),
        ]);
    }
}
