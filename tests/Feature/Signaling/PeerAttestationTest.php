<?php

namespace Dauvray\Socializer\Tests\Feature\Signaling;

use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\Attributes\Test;

/**
 * `/attest-peer-id` et `/verify-peer-attestation` — ce qui corrobore l'identité d'un pair entrant.
 *
 * LA FAILLE QU'ELLES FERMENT. Le chemin (a) de `_isAuthorizedIncomingPeer` (appartenance à la room)
 * admettait sur le seul `metadata.from`, un champ que l'émetteur choisit. Un membre de la room qui
 * ouvrait un SECOND `new Peer()` obtenait un UUID que rien ne mappait — donc `resolvedSlug = null`,
 * donc aucune contradiction à opposer — et parlait ensuite sous l'identité d'un autre membre : chat,
 * `BROADCAST_STATE` et `AUDIO_MUTE_TOGGLE` lisent tous `resolveRemoteSlug`. Le récepteur ne pouvait
 * pas trancher : le cas nominal de la présence et l'usurpation ont la MÊME signature locale (slug
 * déclaré membre, peerId inconnu).
 *
 * LE MÉCANISME TIENT EN UNE LIGNE, et c'est `le_slug_atteste_est_celui_de_l_authentifie` qui la
 * garde : **le slug signé vient d'`Auth::user()`, jamais du corps**. Un attaquant n'obtient donc
 * jamais qu'une attestation à SON nom, qui contredit dès qu'il la présente sous le `from` d'un
 * autre — c'est le cas `une_attestation_ne_vaut_que_pour_le_slug_qu_elle_porte`, qui EST le test de
 * la faille.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVERA JAMAIS : que l'attestation ARRIVE au récepteur et qu'elle y soit
 * confrontée à `conn.peer`. Toute cette moitié vit dans le bundle et se prouve côté JS
 * (`usePeerTransport.incomingAuth.test.js` pour le garde, `scenarios/incomingSpoof.test.js` pour la
 * faille vue du pair d'en face — le seul étage où elle soit visible). Les deux suites gardent chacune
 * une moitié d'un même invariant, et rien dans le build ne les rapproche.
 *
 * ⚠️ Ce fichier n'assume AUCUN `SOCIALIZER_PEER_ATTESTATION_SECRET` : le repli dérivé d'`APP_KEY` est
 * le chemin de production d'une installation qui n'a pas ajouté de variable, donc c'est celui qu'il
 * faut exercer par défaut. `le_secret_dedie_prime_sur_la_derivation_d_app_key` couvre l'autre.
 */
class PeerAttestationTest extends TestCase
{
    private const ISSUE_URI = '/attest-peer-id';

    private const VERIFY_URI = '/verify-peer-attestation';

    private const PEER_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

    private const OTHER_PEER_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';

    protected function setUp(): void
    {
        parent::setUp();

        // ⚠️ NÉCESSAIRE, et c'est un delta de harnais, pas un détail de confort : `phpunit.xml` ne
        // définit pas `APP_KEY` et Testbench n'en fabrique pas. Sans cette ligne, le repli du
        // contrôleur ne trouve rien à dériver, le mécanisme s'annonce INACTIF, et toute la suite
        // serait verte en ne gardant plus rien. Une application Laravel réelle ne démarre pas sans
        // `APP_KEY` — c'est donc le harnais qui est en retard sur la production, pas l'inverse.
        //
        // Le format `base64:` est celui d'un `php artisan key:generate` : la clé est utilisée telle
        // quelle comme matière de dérivation, jamais déchiffrée, mais la reproduire ici évite qu'un
        // futur contrôleur qui la décoderait passe ces tests sur une forme qui n'existe pas en
        // production.
        $this->app['config']->set('app.key', 'base64:'.base64_encode(str_repeat('k', 32)));
    }

    /*
    |--------------------------------------------------------------------------
    | Helpers
    |--------------------------------------------------------------------------
    */

    private function setAttestation(string $key, mixed $value): void
    {
        $this->app['config']->set('socializer.signaling.attestation.'.$key, $value);
    }

    /**
     * L'attestation servie à `$name` pour `$peerId` — le geste que le client fait à l'`'open'`.
     */
    private function issueFor(string $name, string $peerId = self::PEER_ID): string
    {
        return $this->actingAs($this->makeUser($name))
            ->postJson(self::ISSUE_URI, ['peerId' => $peerId])
            ->json('attestation');
    }

    /**
     * Le verdict rendu au récepteur — `null` ou le slug attesté.
     */
    private function verdictFor(string $attestation, string $peerId = self::PEER_ID): ?string
    {
        return $this->actingAs($this->makeUser('recepteur-'.uniqid()))
            ->postJson(self::VERIFY_URI, ['attestation' => $attestation, 'peerId' => $peerId])
            ->json('slug');
    }

    /**
     * Les revendications d'une attestation, décodées sans vérifier la signature.
     *
     * @return array<string, mixed>
     */
    private function claimsOf(string $attestation): array
    {
        [$payload] = explode('.', $attestation);

        return json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
    }

    /*
    |--------------------------------------------------------------------------
    | Délivrance
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function le_slug_atteste_est_celui_de_l_authentifie(): void
    {
        $alice = $this->makeUser('alice');

        // Le corps réclame l'identité de quelqu'un d'AUTRE. C'est le seul geste que l'attaquant a
        // à sa disposition, et il ne doit rien produire : invariant 1 de la signalisation, et ici
        // il n'est pas une précaution parmi d'autres — c'est le mécanisme entier.
        $response = $this->actingAs($alice)->postJson(self::ISSUE_URI, [
            'peerId' => self::PEER_ID,
            'slug' => 'bob',
            'fromUserSlug' => 'bob',
        ]);

        $response->assertOk();

        $this->assertSame($alice->slug, $this->claimsOf($response->json('attestation'))['s']);
    }

    #[Test]
    public function un_invite_n_atteint_pas_la_route(): void
    {
        // La différence de nature avec `/get-ice-servers`, qui est publique et rend toujours 200
        // parce que la coquille SPA monte `data-app` avant tout login : un invité n'a AUCUNE
        // identité à faire attester, donc aucune raison d'être servi. Le garde est ici la pile de
        // middlewares (`auth`), pas une ligne du contrôleur.
        $this->postJson(self::ISSUE_URI, ['peerId' => self::PEER_ID])->assertUnauthorized();
    }

    #[Test]
    public function un_peer_id_qui_n_est_pas_un_uuid_est_refuse(): void
    {
        // Même règle qu'à l'autre bout de la chaîne (`UserController::responseToPeerId`). Un format
        // libre ici ferait signer n'importe quelle chaîne, et l'attestation authentifierait alors
        // autre chose qu'un pair.
        $this->actingAs($this->makeUser('alice'))
            ->postJson(self::ISSUE_URI, ['peerId' => 'pas-un-uuid'])
            ->assertStatus(422);

        $this->actingAs($this->makeUser('bob'))
            ->postJson(self::ISSUE_URI, [])
            ->assertStatus(422);
    }

    #[Test]
    public function la_charge_utile_ne_relaie_que_les_trois_cles_attendues(): void
    {
        $this->setAttestation('secret', 'secret-de-test-qui-ne-doit-jamais-sortir');

        $response = $this->actingAs($this->makeUser('alice'))
            ->postJson(self::ISSUE_URI, ['peerId' => self::PEER_ID]);

        // LISTE BLANCHE, JAMAIS LISTE NOIRE — la doctrine de `turnServer()` s'applique telle quelle.
        // Contre-épreuve : un splat de `config('socializer.signaling.attestation')` fait rougir ce
        // cas en montrant le secret dans le corps. Ce qui fuiterait ici n'est pas un mot de passe de
        // relais, c'est de quoi forger l'identité de n'importe quel utilisateur.
        $this->assertSame(
            ['attestation', 'enforce', 'attestation_ttl'],
            array_keys($response->json()),
        );

        $response->assertDontSee('secret-de-test-qui-ne-doit-jamais-sortir');
    }

    #[Test]
    public function le_ttl_est_annonce_au_client_et_borne_reellement_la_charge(): void
    {
        $this->setAttestation('ttl', 60);

        Carbon::setTestNow('2026-08-29 12:00:00');

        $response = $this->actingAs($this->makeUser('alice'))
            ->postJson(self::ISSUE_URI, ['peerId' => self::PEER_ID]);

        // Les deux sont la MÊME valeur par construction — le contrôleur lit le TTL une fois. Deux
        // lectures se laisseraient désynchroniser par un `config()->set` entre les deux, et le
        // client programmerait alors son rafraîchissement après l'échéance réelle.
        $this->assertSame(60, $response->json('attestation_ttl'));

        // `assertSame` exact et non une assertion à fenêtre : celle-ci resterait VERTE sur un TTL
        // faux d'un facteur 60. C'est ce qui impose `now()` plutôt que `time()` dans le contrôleur.
        $this->assertSame(
            Carbon::now()->getTimestamp() + 60,
            $this->claimsOf($response->json('attestation'))['e'],
        );
    }

    #[Test]
    public function la_politique_enforce_est_celle_du_serveur_et_voyage_avec_l_attestation(): void
    {
        // Elle sort d'ici et non d'une constante compilée : un `VITE_*` la figerait à la
        // construction de l'image et la promettrait éditable dans un `.env` qu'elle ne lirait
        // jamais.
        $alice = $this->makeUser('alice');

        $this->assertFalse(
            $this->actingAs($alice)->postJson(self::ISSUE_URI, ['peerId' => self::PEER_ID])->json('enforce')
        );

        $this->setAttestation('enforce', true);

        $this->assertTrue(
            $this->actingAs($alice)->postJson(self::ISSUE_URI, ['peerId' => self::PEER_ID])->json('enforce')
        );
    }

    #[Test]
    public function sans_secret_ni_app_key_le_mecanisme_s_annonce_inactif(): void
    {
        $this->setAttestation('secret', null);
        $this->setAttestation('enforce', true);
        $this->app['config']->set('app.key', '');

        $response = $this->actingAs($this->makeUser('alice'))
            ->postJson(self::ISSUE_URI, ['peerId' => self::PEER_ID]);

        $response->assertOk();

        // Surtout pas une signature sur une clé vide : elle serait reproductible par n'importe qui,
        // et le vérificateur la validerait pour tout le monde.
        $this->assertNull($response->json('attestation'));

        // ⚠️ `enforce` est forcé à FAUX malgré la config. Servir `true` sans pouvoir délivrer
        // d'attestation ferait refuser des pairs légitimes en se réclamant d'un contrôle qui
        // n'existe pas — un fail-closed sur une panne de configuration, c'est-à-dire la panne la
        // plus difficile à diagnostiquer depuis un navigateur.
        $this->assertFalse($response->json('enforce'));

        // Rien à rafraîchir, donc la clé est ABSENTE plutôt que nulle — même contrat que
        // `credential_ttl` : côté client, `typeof payload.attestation_ttl === 'number'` suffit.
        $this->assertArrayNotHasKey('attestation_ttl', $response->json());
    }

    #[Test]
    public function le_secret_dedie_prime_sur_la_derivation_d_app_key(): void
    {
        // La preuve est indirecte, et c'est la seule disponible : une attestation délivrée sous un
        // secret ne vérifie plus sous un autre. Si la clé dédiée était ignorée, les deux
        // attestations se vérifieraient l'une comme l'autre.
        $this->setAttestation('secret', 'premier-secret');
        $attestation = $this->issueFor('alice');

        $this->assertSame('alice', $this->verdictFor($attestation));

        $this->setAttestation('secret', 'second-secret');

        $this->assertNull($this->verdictFor($attestation));
    }

    /*
    |--------------------------------------------------------------------------
    | Vérification
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function une_attestation_intacte_rend_le_slug_de_son_porteur(): void
    {
        $this->assertSame('alice', $this->verdictFor($this->issueFor('alice')));
    }

    #[Test]
    public function une_attestation_ne_vaut_que_pour_le_slug_qu_elle_porte(): void
    {
        // ⚠️ LE TEST DE LA FAILLE. Mallory ouvre un second `Peer`, obtient une attestation pour SON
        // peerId neuf — le serveur ne lui en délivrera jamais d'autre — et se présente sous le slug
        // d'alice. Le verdict la nomme, elle : le garde entrant voit alors `resolvedSlug` ≠
        // `declaredFrom` et refuse. Avant ce mécanisme, `resolvedSlug` valait `null` et l'admission
        // était accordée sur le seul `metadata.from`.
        $this->assertSame('mallory', $this->verdictFor($this->issueFor('mallory')));
    }

    #[Test]
    public function une_attestation_ne_vaut_pas_pour_un_autre_peer_id(): void
    {
        // Sans ce contrôle, l'attestation d'un pair suffirait à en admettre un autre : elle
        // prouverait « ce couple a été signé », jamais « c'est CE pair-ci ». C'est la confrontation
        // avec `conn.peer` qui fait tout le travail côté récepteur.
        $this->assertNull($this->verdictFor($this->issueFor('alice'), self::OTHER_PEER_ID));
    }

    #[Test]
    public function une_signature_alteree_ne_vaut_rien(): void
    {
        [$payload, $signature] = explode('.', $this->issueFor('alice'));

        // La charge est réécrite au nom d'alice sous une signature qui ne la couvre plus : c'est la
        // forme exacte de la forge que `hash_equals` doit repousser.
        $forge = rtrim(strtr(base64_encode((string) json_encode([
            'v' => 1,
            'p' => self::PEER_ID,
            's' => 'alice',
            'e' => Carbon::now()->getTimestamp() + 3600,
        ])), '+/', '-_'), '=');

        $this->assertNull($this->verdictFor($forge.'.'.$signature));
        $this->assertNull($this->verdictFor($payload.'.'.$signature.'x'));
    }

    #[Test]
    public function une_attestation_expiree_ne_vaut_rien(): void
    {
        $this->setAttestation('ttl', 60);

        Carbon::setTestNow('2026-08-29 12:00:00');
        $attestation = $this->issueFor('alice');

        Carbon::setTestNow('2026-08-29 12:00:59');
        $this->assertSame('alice', $this->verdictFor($attestation));

        // L'échéance est la SEULE borne du rejeu : qui détient l'attestation d'un pair parti et
        // reprend son UUID sur le serveur PeerJS (possible passé `alive_timeout`, 60 s) la rejoue
        // avec succès jusque-là. La fermer demande que le serveur PeerJS valide lui-même
        // l'inscription d'un id — hors de ce paquet, et écrit comme tel dans `securite.md`.
        Carbon::setTestNow('2026-08-29 12:01:01');
        $this->assertNull($this->verdictFor($attestation));
    }

    #[Test]
    public function une_attestation_malformee_ne_leve_jamais(): void
    {
        // La route reçoit ce qu'un pair distant a mis dans sa `metadata` : n'importe quoi. Aucune de
        // ces formes ne doit produire autre chose qu'un `null` — une 500 ici serait une trace
        // offerte, et `ExceptionLeakTest` garde la même règle sur les cinq routes de signalisation.
        foreach (['', 'sans-point', 'a.b.c', '.', 'YQ.Yg', str_repeat('a', 200).'.'.str_repeat('b', 43)] as $malformee) {
            $this->assertNull($this->verdictFor($malformee), 'attestation : '.$malformee);
        }
    }

    #[Test]
    public function une_attestation_trop_longue_est_refusee_avant_tout_decodage(): void
    {
        // Borne de forme, pas de sécurité : elle empêche qu'un corps arbitraire traverse
        // `json_decode`. Sa jumelle côté JS est `MAX_ATTESTATION_LENGTH` (`webrtc2.config.js`), et
        // rien dans le build ne les rapproche.
        $this->actingAs($this->makeUser('alice'))
            ->postJson(self::VERIFY_URI, [
                'attestation' => str_repeat('a', 513),
                'peerId' => self::PEER_ID,
            ])
            ->assertStatus(422);
    }

    #[Test]
    public function un_refus_de_verification_reste_un_200(): void
    {
        // Une attestation refusée n'est PAS une erreur de transport, et `AjaxService.load`
        // d'estarter fait `document.location.reload()` sur un 401/419 : un 4xx transformerait un
        // refus en boucle de rechargement. Le verdict est donc dans le corps.
        $this->actingAs($this->makeUser('alice'))
            ->postJson(self::VERIFY_URI, ['attestation' => 'sans-point', 'peerId' => self::PEER_ID])
            ->assertOk()
            ->assertExactJson(['slug' => null]);
    }

    #[Test]
    public function la_verification_ne_dit_jamais_pourquoi_elle_refuse(): void
    {
        $this->setAttestation('ttl', -60);
        $expiree = $this->issueFor('alice');

        $this->setAttestation('ttl', 300);
        [$payload] = explode('.', $this->issueFor('bob'));

        $recepteur = $this->makeUser('carol');

        // Trois causes distinctes — expiration, signature invalide, peerId discordant — et une
        // seule réponse, corps compris. Même doctrine que le 403 uniforme du garde de relation :
        // nommer la cause offrirait un oracle à qui cherche à forger.
        foreach ([
            ['attestation' => $expiree, 'peerId' => self::PEER_ID],
            ['attestation' => $payload.'.signature-forgee', 'peerId' => self::PEER_ID],
            ['attestation' => $this->issueFor('dave'), 'peerId' => self::OTHER_PEER_ID],
        ] as $cas) {
            $this->actingAs($recepteur)->postJson(self::VERIFY_URI, $cas)
                ->assertOk()
                ->assertExactJson(['slug' => null]);
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Plafond
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function les_deux_routes_sont_plafonnees_par_le_bucket_mesh(): void
    {
        // Elles ne relaient rien vers un tiers — aucun `sendNow()`, donc aucune victime à protéger
        // d'une cadence. Le plafond qu'elles portent est celui du groupe, et il est juste ici :
        // elles sont privées, donc `socializer-signaling` a un émetteur authentifié à mettre en
        // clé. C'est ce qui les sépare de `/get-ice-servers`, publique et volontairement sans
        // `throttle`.
        $this->app['config']->set('socializer.signaling.throttle.mesh_per_minute', 2);

        $alice = $this->makeUser('alice');

        $this->actingAs($alice)->postJson(self::ISSUE_URI, ['peerId' => self::PEER_ID])->assertOk();
        $this->actingAs($alice)->postJson(self::ISSUE_URI, ['peerId' => self::PEER_ID])->assertOk();
        $this->actingAs($alice)->postJson(self::ISSUE_URI, ['peerId' => self::PEER_ID])->assertStatus(429);

        // Même bucket, donc le jeton est déjà consommé : c'est bien UNE cadence par utilisateur
        // pour les deux routes, et non deux compteurs indépendants.
        $this->actingAs($alice)->postJson(self::VERIFY_URI, [
            'attestation' => 'sans-point',
            'peerId' => self::PEER_ID,
        ])->assertStatus(429);
    }
}
