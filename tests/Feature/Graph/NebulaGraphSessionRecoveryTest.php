<?php

namespace Dauvray\Socializer\Tests\Feature\Graph;

use Dauvray\Socializer\app\Exceptions\NebulaGraphException;
use Dauvray\Socializer\Tests\Stubs\FakeGraphService;
use Dauvray\Socializer\Tests\Stubs\FakeSessionClient;
use Dauvray\Socializer\Tests\Stubs\FakeThriftClient;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Nebula\Common\ErrorCode;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

/**
 * Un processus long survit au recyclage de la session NebulaGraph.
 *
 * ── LE DÉFAUT ─────────────────────────────────────────────────────────────────────────────────
 *
 * La session est partagée par le cache entre tous les conteneurs et recyclée périodiquement par
 * `NebulaGraphClient::authenticate()`. Ce recyclage est NÉCESSAIRE : sans lui les sessions
 * s'accumulent jusqu'au plafond de NebulaGraph, qui bloque alors l'application entière — c'est
 * arrivé. Mais un processus LONG (`reverb`, `queue`) résout le singleton `nebulaGraph` une seule
 * fois à son démarrage : au premier recyclage il garde en mémoire un identifiant mort, et **rien ne
 * le lui disait**. La socket Thrift reste ouverte, l'erreur est applicative (-1002), aucun code ne
 * la détectait.
 *
 * Mesuré le 25/08/2026 : 288 refus côté graphd en une journée, 243 journalisés côté application,
 * tous sur le heartbeat de présence. La projection `connected` ne s'écrivait plus du tout — en
 * silence complet, le rattrapage d'`OnlineUsersService` étant muet par décision.
 *
 * ── CE QUE CE FICHIER ÉPINGLE ─────────────────────────────────────────────────────────────────
 *
 * Le correctif est **strictement additif** : il ne touche ni à la rotation, ni au `KILL SESSION`.
 * Les deux propriétés qui le rendent sûr sont donc celles à ne jamais laisser rougir :
 *
 *  1. un refus de session **récupéré** ne produit **aucun** `Log::error` — sinon on aurait remplacé
 *     243 erreurs par 243 erreurs d'une autre couleur ;
 *  2. le chemin nominal de récupération (adoption d'une session publiée par un autre processus) ne
 *     crée **aucune** session — sinon la saturation se rouvre.
 *
 * ⚠️ **CE QUE CE FICHIER NE PROUVE PAS.** Le harnais force `cache.default = 'array'`
 * (`TestCase.php`), qui ne sérialise pas : un identifiant de session y fait l'aller-retour en
 * conservant son type. La pathologie du store Redis — `RedisStore::unserialize` rend la CHAÎNE brute
 * dès que la valeur `is_numeric`, là où `DatabaseStore` rend un int — est donc **inobservable ici**.
 * C'est la raison des `(string)` de `refreshSession()` : sans eux, un `!==` entre un int et une
 * chaîne serait toujours vrai sous Redis, la branche d'adoption ré-adopterait le cadavre à l'infini
 * et tout le rejeu deviendrait un no-op silencieux. Aucun test de ce fichier ne peut le montrer.
 *
 * Complément : [`NebulaGraphSeamTest`](NebulaGraphSeamTest.php) épingle l'asymétrie
 * lecture/écriture/DDL de la même couture, qu'aucun test d'ici ne doit déplacer.
 */
class NebulaGraphSessionRecoveryTest extends TestCase
{
    /** Les trois codes qui disent « ta session ne vaut plus rien ». */
    public static function codesDeSession(): array
    {
        return [
            'E_SESSION_INVALID' => [ErrorCode::E_SESSION_INVALID],
            'E_SESSION_TIMEOUT' => [ErrorCode::E_SESSION_TIMEOUT],
            'E_SESSION_NOT_FOUND' => [ErrorCode::E_SESSION_NOT_FOUND],
        ];
    }

    /**
     * Les codes qui ne doivent JAMAIS déclencher de rejeu.
     *
     * `E_EXECUTION_ERROR` (-1005) et `E_SEMANTIC_ERROR` (-1009) y sont **délibérément** : ce sont
     * ceux qui peuvent survenir APRÈS exécution, donc les rejouer rejouerait une requête déjà
     * appliquée.
     */
    public static function codesSansRejeu(): array
    {
        return [
            'SyntaxError' => [-1004],
            'E_EXECUTION_ERROR' => [ErrorCode::E_EXECUTION_ERROR],
            'E_SEMANTIC_ERROR' => [ErrorCode::E_SEMANTIC_ERROR],
            'E_DISCONNECTED' => [ErrorCode::E_DISCONNECTED],
        ];
    }

    /**
     * Arme un refus de session APRÈS la construction de la connexion.
     *
     * L'ordre importe : le constructeur de `NebulaGraphConnection` émet un `USE <space>`, qui
     * consommerait le refus si on l'armait avant.
     *
     * @return array{0: \Dauvray\Socializer\app\Helpers\NebulaGraphConnection, 1: FakeThriftClient}
     */
    private function connexionQuiRefuseUneFois(int $code = ErrorCode::E_SESSION_INVALID): array
    {
        $client = new FakeThriftClient;
        $connection = $this->fakeNebulaGraphConnection($client);
        $client->failsTimes(1, $code);

        return [$connection, $client];
    }

    /*
    |--------------------------------------------------------------------------
    | 1. Le rejeu
    |--------------------------------------------------------------------------
    */

    /**
     * La reproduction littérale de l'incident du 25/08 : le heartbeat de présence, dont la session
     * vient d'être recyclée sous les pieds du processus Reverb.
     */
    #[Test]
    public function une_ecriture_dont_la_session_est_refusee_est_rejouee_et_reussit(): void
    {
        [$connection, $client] = $this->connexionQuiRefuseUneFois();

        $connection->updateVertex('user', 'user35', ['connected' => 1]);

        $statements = $client->statements();

        $this->assertCount(3, $statements, 'attendu : requête refusée, USE, rejeu');
        $this->assertStringContainsString('UPDATE VERTEX', $statements[0]);
        $this->assertSame('USE harnais', $statements[1]);
        $this->assertSame($statements[0], $statements[2], 'le rejeu doit être la requête À L\'IDENTIQUE');
        $this->assertSame(1, $client->refreshCount());
    }

    /**
     * Le chemin LECTURE : il doit rendre ses lignes, pas le `JsonResponse` du refus.
     */
    #[Test]
    public function une_lecture_dont_la_session_est_refusee_est_rejouee(): void
    {
        [$connection, $client] = $this->connexionQuiRefuseUneFois();

        $this->assertSame([], $connection->execute('MATCH (u:user) RETURN u'));
        $this->assertCount(3, $client->statements());
    }

    #[Test]
    #[DataProvider('codesDeSession')]
    public function les_trois_codes_de_session_declenchent_le_rejeu(int $code): void
    {
        [$connection, $client] = $this->connexionQuiRefuseUneFois($code);

        $connection->execute('MATCH (u:user) RETURN u');

        $this->assertCount(3, $client->statements());
        $this->assertSame(1, $client->refreshCount());
    }

    /*
    |--------------------------------------------------------------------------
    | 2. Les contrôles négatifs — ce qui NE doit pas rejouer
    |--------------------------------------------------------------------------
    */

    /**
     * Le garde qui interdit à une erreur de syntaxe de partir en boucle, et à une erreur
     * d'exécution d'être rejouée alors qu'elle a peut-être déjà écrit.
     */
    #[Test]
    #[DataProvider('codesSansRejeu')]
    public function les_autres_codes_ne_declenchent_aucun_rejeu(int $code): void
    {
        [$connection, $client] = $this->connexionQuiRefuseUneFois($code);

        $connection->execute('MATCH (u:user) RETURN u');

        $this->assertCount(1, $client->statements());
        $this->assertSame(0, $client->refreshCount());
        $this->assertNotContains('USE harnais', $client->statements());
    }

    /**
     * UN SEUL rejeu, jamais de boucle : le refus persiste, la couture ne s'entête pas.
     *
     * Le refus est posé par RÈGLE et non par le défaut, pour que le `USE` intermédiaire réussisse —
     * sinon la couture court-circuite plus tôt (cas du test suivant) et ce garde-ci ne serait pas
     * exercé.
     */
    #[Test]
    public function un_rejet_de_session_persistant_ne_rejoue_qu_une_fois(): void
    {
        $client = new FakeThriftClient;
        $connection = $this->fakeNebulaGraphConnection($client);
        $client->failsOn('UPDATE VERTEX', ErrorCode::E_SESSION_INVALID, 'Session not existed!');

        try {
            $connection->updateVertex('user', 'user35', ['connected' => 1]);
            $this->fail('une écriture refusée doit lever');
        } catch (NebulaGraphException $e) {
            $this->assertSame(ErrorCode::E_SESSION_INVALID, $e->nebulaCode());
        }

        $this->assertCount(3, $client->statements(), 'jamais un second rejeu');
    }

    /**
     * Un `USE` lui-même refusé ⇒ on rend la réponse D'ORIGINE, sans rejouer.
     *
     * Sans ça, le rejeu échouerait sur `SpaceNotChosen` et l'appelant verrait un code qui ne dit
     * rien du vrai problème.
     */
    #[Test]
    public function un_use_refuse_annule_le_rejeu_et_rend_le_refus_d_origine(): void
    {
        $client = new FakeThriftClient;
        $connection = $this->fakeNebulaGraphConnection($client);
        $client->failsWith(ErrorCode::E_SESSION_INVALID, 'Session not existed!');

        $resultat = $connection->execute('MATCH (u:user) RETURN u');

        $this->assertInstanceOf(JsonResponse::class, $resultat);
        $this->assertCount(2, $client->statements(), 'attendu : requête refusée, USE refusé — pas de rejeu');
    }

    /**
     * Le contrat de repli : quand le rejeu échoue, le comportement est EXACTEMENT celui d'avant ce
     * correctif. C'est ce qui garantit que la couture ne peut pas être pire que le statu quo.
     */
    #[Test]
    public function un_rejet_persistant_se_comporte_comme_avant_le_correctif(): void
    {
        $lecture = new FakeThriftClient;
        $connexionLecture = $this->fakeNebulaGraphConnection($lecture);
        $lecture->failsOn('MATCH', ErrorCode::E_SESSION_INVALID, 'Session not existed!');

        $this->assertInstanceOf(JsonResponse::class, $connexionLecture->execute('MATCH (u:user) RETURN u'));

        $ecriture = new FakeThriftClient;
        $connexionEcriture = $this->fakeNebulaGraphConnection($ecriture);
        $ecriture->failsOn('UPDATE VERTEX', ErrorCode::E_SESSION_INVALID, 'Session not existed!');

        $this->expectException(NebulaGraphException::class);
        $connexionEcriture->updateVertex('user', 'user35', ['connected' => 1]);
    }

    /**
     * Une réponse que `json_decode` ne sait pas lire n'est pas un refus de session.
     *
     * ⚠️ Ce test vaut surtout par ce qu'il n'affiche pas : sans la garde de forme
     * d'`isSessionRejected()`, `$decoded->errors[0]->code` sur `null` produirait une cascade de
     * warnings PHP, que `phpunit.xml` transforme en échec (`failOnWarning="true"`).
     */
    #[Test]
    public function une_reponse_illisible_ne_declenche_pas_de_rejeu(): void
    {
        $client = new FakeThriftClient;
        $connection = $this->fakeNebulaGraphConnection($client);
        $client->returnsGarbage();

        $this->assertInstanceOf(JsonResponse::class, $connection->execute('MATCH (u:user) RETURN u'));
        $this->assertCount(1, $client->statements());
        $this->assertSame(0, $client->refreshCount());
    }

    /**
     * Le garde « liste vide ⇒ aucune requête » n'émet rien, donc n'a rien à récupérer.
     */
    #[Test]
    public function les_gardes_de_liste_vide_ne_declenchent_aucune_recuperation(): void
    {
        [$connection, $client] = $this->connexionQuiRefuseUneFois();

        $connection->deleteVertex([]);

        $this->assertSame([], $client->statements());
        $this->assertSame(0, $client->refreshCount());
    }

    /**
     * Le régime nominal ne paie rien : ni rejeu, ni authentification, ni requête en plus.
     */
    #[Test]
    public function une_requete_nominale_ne_declenche_ni_rejeu_ni_authentification(): void
    {
        $client = new FakeThriftClient;
        $connection = $this->fakeNebulaGraphConnection($client);

        $connection->execute('MATCH (u:user) RETURN u');

        $this->assertCount(1, $client->statements());
        $this->assertSame(0, $client->refreshCount());
    }

    /*
    |--------------------------------------------------------------------------
    | 3. Le journal — la contrainte centrale du correctif
    |--------------------------------------------------------------------------
    */

    /**
     * **LE test central.** S'il rougit, on a remplacé 243 `Log::error` par 243 `Log::error`, et le
     * correctif n'a rien réglé de ce qu'il prétend régler.
     *
     * Ce qui le rend vrai : la couture enveloppe l'ÉMISSION, pas le décodage — la première réponse
     * n'atteint donc jamais `errorIn()`, seul point de journal du graphe.
     */
    #[Test]
    public function un_rejet_de_session_recupere_ne_journalise_aucune_erreur(): void
    {
        Log::spy();

        [$connection] = $this->connexionQuiRefuseUneFois();

        $connection->updateVertex('user', 'user35', ['connected' => 1]);

        Log::shouldNotHaveReceived('error');
        Log::shouldHaveReceived('warning')->once();
    }

    /**
     * Un refus NON récupéré journalise une fois — pas deux. La première réponse ne passant pas par
     * `errorIn()`, il ne peut y avoir de doublon.
     */
    #[Test]
    public function un_rejet_non_recupere_ne_journalise_qu_une_erreur(): void
    {
        Log::spy();

        $client = new FakeThriftClient;
        $connection = $this->fakeNebulaGraphConnection($client);
        $client->failsOn('MATCH', ErrorCode::E_SESSION_INVALID, 'Session not existed!');

        $connection->execute('MATCH (u:user) RETURN u');

        Log::shouldHaveReceived('error')->once();
    }

    /**
     * L'étranglement : deux récupérations rapprochées ne produisent qu'une ligne.
     *
     * Sans lui, un graphe en vrille — graphd redémarré, sessions purgées à la main — ferait
     * récupérer CHAQUE battement de présence, soit des dizaines de milliers de lignes par jour dès
     * quelques dizaines d'utilisateurs.
     */
    #[Test]
    public function deux_recuperations_rapprochees_ne_journalisent_qu_une_ligne(): void
    {
        Log::spy();

        $client = new FakeThriftClient;
        $connection = $this->fakeNebulaGraphConnection($client);

        $client->failsTimes(1, ErrorCode::E_SESSION_INVALID);
        $connection->updateVertex('user', 'user35', ['connected' => 1]);

        $client->failsTimes(1, ErrorCode::E_SESSION_INVALID);
        $connection->updateVertex('user', 'user2', ['connected' => 1]);

        $this->assertSame(2, $client->refreshCount(), 'les DEUX récupérations ont bien eu lieu');

        Log::shouldHaveReceived('warning')->once();
    }

    /*
    |--------------------------------------------------------------------------
    | 4. Le client — ce que la couture ne peut pas prouver
    |--------------------------------------------------------------------------
    */

    /**
     * **Le test qui protège contre la saturation.** Le chemin nominal de récupération adopte la
     * session publiée par un autre processus : il n'authentifie pas, donc ne crée AUCUNE session.
     *
     * S'il rougit parce que quelqu'un a « simplifié » `refreshSession()` en le faisant toujours
     * ré-authentifier, le compteur de sessions de NebulaGraph repart à la hausse et la panne de
     * saturation se rouvre.
     */
    #[Test]
    public function refreshSession_adopte_la_session_publiee_par_un_autre_processus(): void
    {
        $client = new FakeSessionClient;
        Cache::put('nebulagraph_sessionid', '111');
        $client->authenticate('root', 'nebula');

        // Un autre processus recycle et publie la sienne.
        Cache::put('nebulagraph_sessionid', '222');

        $client->refreshSession('root', 'nebula');

        $this->assertSame('222', $client->getSessionId());
        $this->assertSame(0, $client->service->authenticateCount(), 'aucune session créée');
        $this->assertSame([], $client->service->signOuts(), 'aucune session tuée');
    }

    /**
     * Le repli : le cache porte l'identifiant qu'on vient de voir refusé, donc personne n'a publié
     * mieux. Là seulement on en forge une.
     */
    #[Test]
    public function refreshSession_authentifie_quand_le_cache_porte_le_meme_identifiant_mort(): void
    {
        $client = new FakeSessionClient(new FakeGraphService([333]));
        Cache::put('nebulagraph_sessionid', '111');
        $client->authenticate('root', 'nebula');

        $client->refreshSession('root', 'nebula');

        $this->assertSame(1, $client->service->authenticateCount());
        $this->assertSame('333', $client->getSessionId());
        $this->assertSame('333', (string) Cache::get('nebulagraph_sessionid'), 'la neuve est publiée');
    }

    /**
     * `refreshSession()` n'évince JAMAIS la clé partagée.
     *
     * Un `Cache::forget` y ferait ré-authentifier en meute tous les autres conteneurs, et
     * détruirait la publication d'un tiers qui vient d'aboutir — un effet de bord global pour
     * orienter un `if` local.
     */
    #[Test]
    public function refreshSession_n_evince_jamais_la_cle_partagee(): void
    {
        $client = new FakeSessionClient(new FakeGraphService([444]));
        Cache::put('nebulagraph_sessionid', '111');
        $client->authenticate('root', 'nebula');

        $client->refreshSession('root', 'nebula');

        $this->assertNotNull(
            Cache::get('nebulagraph_sessionid'),
            'la clé doit rester publiée en permanence, jamais absente entre deux écritures'
        );
    }

    /**
     * `logout()` ne vide le cache que pour l'identifiant qui y est publié.
     *
     * Avant : l'éviction était inconditionnelle, donc fermer la session d'un TIERS détruisait la
     * publication de la session courante — ce que `socializer:nebula-clear-sessions` produisait à
     * chaque tour de sa boucle.
     */
    #[Test]
    public function logout_ne_vide_le_cache_que_pour_l_identifiant_publie(): void
    {
        $client = new FakeSessionClient;
        Cache::put('nebulagraph_sessionid', '555');
        $client->authenticate('root', 'nebula');

        $client->logout('999');

        $this->assertSame('555', (string) Cache::get('nebulagraph_sessionid'));
        $this->assertSame('555', (string) $client->getSessionId(), 'le client reste utilisable');
        $this->assertSame(['999'], $client->service->signOuts(), 'la session visée est bien fermée');

        $client->logout('555');

        $this->assertNull(Cache::get('nebulagraph_sessionid'));
        $this->assertNull($client->getSessionId());
    }
}
