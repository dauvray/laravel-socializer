<?php

namespace Dauvray\Socializer\Tests\Feature\Graph;

use Dauvray\Socializer\app\Exceptions\NebulaGraphException;
use Dauvray\Socializer\Tests\Stubs\FakeThriftClient;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

/**
 * E7 — une écriture de graphe qui échoue ne se tait plus.
 *
 * `responseJson()` faisait `return response()->json($erreur, 500)` sur erreur nGQL : un OBJET,
 * donc truthy, sans exception et sans journal. Comme ~80 des ~95 sites d'écriture du paquet
 * ignorent la valeur de retour, un échec d'écriture était TOTALEMENT muet — pas d'arête, pas de
 * log, pas d'exception, et une interface qui affiche « ✅ ».
 *
 * Pire, `insertVertex` masquait activement : `return is_array($result) && count($result) ? $result
 * : $items`. Un INSERT ne rend jamais de ligne, donc le succès retombait sur `$items` — la chaîne
 * construite LOCALEMENT, avant l'envoi — et l'échec aussi. Succès et échec rendaient la même
 * valeur, dont les appelants extrayaient un vid par `getVertexIdFromInsert()` qu'ils écrivaient en
 * MySQL/Mongo : un vid que le graphe ne contient pas.
 *
 * Le principe du correctif tient en une phrase : **une lecture ratée doit se dégrader en refus,
 * une écriture ratée ne doit pas se dégrader du tout.** Les lectures gardent donc le contrat
 * d'E4.1 (réponse inexploitable ⇒ refus + `Log::warning` chez l'appelant), les 6 méthodes DML
 * lèvent, et le DDL se contente du journal — un schéma NebulaGraph est asynchrone et la migration
 * doit rester rejouable.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. Les charges JSON viennent de `FakeThriftClient` et sont
 * ÉCRITES À LA MAIN, pas capturées contre un cluster. Elles prouvent comment la couture les
 * interprète, jamais qu'une requête est valide ni qu'elle fait ce qu'on croit. La limite de la
 * décision 3 du harnais (`docs/architecture/tests.md`) se déplace d'un cran, elle ne disparaît
 * pas. En particulier, « le graphe refuse `DELETE VERTEX` sans argument » est un POSTULAT de ce
 * fichier, à contre-vérifier contre le cluster de dev.
 *
 * Ce que ce fichier prouve : que la couture DISTINGUE une erreur nGQL d'un résultat vide, que les
 * écritures lèvent, que les lectures NE lèvent PAS (tout E4.1 en dépend), que tout est journalisé,
 * et le nGQL réellement construit.
 */
class NebulaGraphSeamTest extends TestCase
{
    /**
     * Les 6 méthodes d'écriture DML, avec des arguments valides pour leurs constructeurs de
     * requête. Le label `comment` est choisi pour `vertices.comment` = `['content' => null]`.
     *
     * ⚠️ `insertVertex` reçoit toujours un `id` : sans lui il appelle `uniqidReal()`, un helper de
     * l'app hôte que le paquet ne déclare nulle part — indisponible sous Testbench.
     *
     * @return array<string, array{0: string, 1: array<int, mixed>}>
     */
    public static function methodesDEcriture(): array
    {
        return [
            'insertVertex' => ['insertVertex', ['comment', ['id' => 'c1', 'content' => 'bonjour']]],
            'updateVertex' => ['updateVertex', ['comment', 'c1', ['content' => 'bonsoir']]],
            'deleteVertex' => ['deleteVertex', [['c1']]],
            'insertEdge' => ['insertEdge', ['reply_of', ['c1->c2' => ['created_at' => 1]]]],
            'updateEdge' => ['updateEdge', ['reply_of', 'c1->c2', ['created_at' => 2]]],
            'deleteEdge' => ['deleteEdge', ['reply_of', ['c1->c2']]],
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | 1. Le décodage — une erreur n'est pas un résultat vide
    |--------------------------------------------------------------------------
    */

    /**
     * Le second test nommé par E7 : « une requête syntaxiquement invalide ne se confond pas avec
     * une réponse vide ».
     *
     * ⚠️ Vert avant comme après le correctif — la distinction existe depuis toujours AU NIVEAU DE
     * LA COUTURE. Ce qui manquait, c'est que personne en aval ne la lisait, et qu'aucune trace
     * n'en subsistait (cf. section 4). Sa valeur ici est d'épingler le contrat de LECTURE qu'E7
     * s'interdit de bouger : si ce test rougit après l'étape 3, c'est qu'E4.1 a été inversée.
     */
    #[Test]
    public function une_erreur_ngql_ne_se_confond_pas_avec_un_resultat_vide(): void
    {
        $refus = $this->fakeNebulaGraphConnection(
            (new FakeThriftClient)->failsWith(-1004, 'SyntaxError: near `WHERE`')
        );

        $this->assertInstanceOf(JsonResponse::class, $refus->execute('MATCH (u:user) RETURN u'));

        $vide = $this->fakeNebulaGraphConnection(new FakeThriftClient);

        $this->assertSame([], $vide->execute('MATCH (u:user) RETURN u'));
    }

    /**
     * Le cas que le `errors[0]->code` d'origine ne couvrait pas.
     *
     * Un transport dégradé (502 d'un proxy, connexion coupée) rend quelque chose que `json_decode`
     * ne sait pas lire. `null->errors[0]->code` produit alors une cascade de warnings PHP, puis
     * `null != 0` vaut FALSE : la couture conclut « succès », et rend `[]`. Une réponse illisible
     * était donc indistinguable d'une lecture vide légitime.
     *
     * `phpunit.xml` a `failOnWarning="true"` : ce test rougit deux fois, sur les warnings et sur
     * l'assertion.
     */
    #[Test]
    public function une_reponse_illisible_est_un_refus_et_non_un_succes_vide(): void
    {
        $connection = $this->fakeNebulaGraphConnection((new FakeThriftClient)->returnsGarbage());

        $this->assertInstanceOf(JsonResponse::class, $connection->execute('MATCH (u:user) RETURN u'));
    }

    /*
    |--------------------------------------------------------------------------
    | 2. Les écritures lèvent
    |--------------------------------------------------------------------------
    */

    #[Test]
    #[DataProvider('methodesDEcriture')]
    public function une_ecriture_refusee_leve(string $methode, array $arguments): void
    {
        $connection = $this->fakeNebulaGraphConnection(
            (new FakeThriftClient)->failsWith(-1005, 'SemanticError')
        );

        $this->expectException(NebulaGraphException::class);

        $connection->{$methode}(...$arguments);
    }

    #[Test]
    #[DataProvider('methodesDEcriture')]
    public function une_ecriture_qui_reussit_ne_leve_pas(string $methode, array $arguments): void
    {
        $connection = $this->fakeNebulaGraphConnection(new FakeThriftClient);

        $connection->{$methode}(...$arguments);

        $this->assertTrue(true, 'Une écriture nominale a levé.');
    }

    /**
     * Le 🔴 central, et le seul angle sous lequel il est observable.
     *
     * Le symptôme n'est pas « ça échoue mal », c'est que succès et échec rendaient LA MÊME VALEUR :
     * `$items`, construit avant l'envoi. Aucun appelant, si consciencieux soit-il, ne pouvait les
     * distinguer — il n'y avait rien à distinguer.
     */
    #[Test]
    public function une_insertion_de_sommet_refusee_ne_rend_plus_la_meme_chose_qu_un_succes(): void
    {
        $succes = $this->fakeNebulaGraphConnection(new FakeThriftClient)
            ->insertVertex('comment', ['id' => 'c1', 'content' => 'bonjour']);

        $refuse = $this->fakeNebulaGraphConnection(
            (new FakeThriftClient)->failsWith(-1004, 'SyntaxError')
        );

        $this->expectException(NebulaGraphException::class);

        $this->assertNotSame(
            $succes,
            $refuse->insertVertex('comment', ['id' => 'c1', 'content' => 'bonjour']),
            'Succès et échec rendent la même valeur : aucun appelant ne peut les distinguer.'
        );
    }

    /**
     * Le vid fantôme — la conséquence en base du masquage ci-dessus.
     *
     * `getVertexIdFromInsert()` (`src/app/Helpers/Socializer.php:117`) parse `$items` pour en
     * extraire le vid, que les appelants écrivent ensuite en MySQL/Mongo (`Services/Chat.php:244`,
     * `Services/Feed.php:229`, `Services/Page.php:52`). Sur une insertion refusée, ce vid pointait
     * vers un sommet qui n'existe pas — et rien, nulle part, ne le signalait.
     */
    #[Test]
    public function une_insertion_de_sommet_refusee_ne_fabrique_pas_de_vid_fantome(): void
    {
        $connection = $this->fakeNebulaGraphConnection(
            (new FakeThriftClient)->failsWith(-1004, 'SyntaxError')
        );

        $this->expectException(NebulaGraphException::class);

        getVertexIdFromInsert($connection->insertVertex('comment', ['id' => 'c1', 'content' => 'x']));
    }

    /**
     * Ce que l'exception porte — et surtout ce qu'elle ne porte PAS.
     *
     * Le nGQL ne va jamais dans `getMessage()` : il contient du contenu utilisateur après
     * `VALUES` (corps de commentaire, titre de chat), `phpunit.xml` force `APP_DEBUG=true`, et
     * hors `UserController` aucun contrôleur du paquet n'a de `try/catch`. C'est la leçon C3
     * appliquée en amont — un message qui porterait la requête la ferait fuiter dans un corps 500.
     */
    #[Test]
    public function l_exception_porte_le_diagnostic_sans_fuiter_la_requete(): void
    {
        $connection = $this->fakeNebulaGraphConnection(
            (new FakeThriftClient)->failsWith(-1004, 'SyntaxError: near `VALUES`')
        );

        try {
            $connection->insertVertex('comment', ['id' => 'c1', 'content' => 'texte confidentiel']);
            $this->fail('Une écriture refusée n\'a pas levé.');
        } catch (NebulaGraphException $e) {
            $this->assertSame('insertVertex', $e->operation());
            $this->assertSame(-1004, $e->nebulaCode());
            $this->assertStringContainsString('INSERT VERTEX', $e->query());
            $this->assertStringNotContainsString('texte confidentiel', $e->getMessage());
            // Le code nGQL est négatif et `getCode()` est lu comme statut HTTP par certains
            // renderers : il vit dans `nebulaCode()`, jamais dans le code de l'exception.
            $this->assertSame(0, $e->getCode());
        }
    }

    /*
    |--------------------------------------------------------------------------
    | 3. Les lectures ne lèvent pas — la garantie dont E4.1 dépend entièrement
    |--------------------------------------------------------------------------
    */

    /**
     * Le contrôle négatif du lot, et le plus important.
     *
     * Faire lever la couture ENTIÈRE aurait rendu inatteignables les branches `is_array()` de
     * `_checkCanJoin`, `_checkIsOwner`, `followsMutually` et `Chat::checkRegistration` : un refus
     * 403 serait devenu un 500 sur toute panne de graphe. Et les tests qui les épinglent seraient
     * restés VERTS, puisqu'ils scriptent un `JsonResponse` via une doublure qui ne lève jamais.
     *
     * Ce test est ce qui interdit cette inversion. S'il rougit, la portée d'E7 a débordé.
     */
    #[Test]
    public function une_lecture_refusee_ne_leve_pas(): void
    {
        $connection = $this->fakeNebulaGraphConnection(
            (new FakeThriftClient)->failsWith(-1005, 'SemanticError')
        );

        $this->assertInstanceOf(
            JsonResponse::class,
            $connection->execute('MATCH (c:chat) RETURN c'),
            'Une lecture a levé : les quatre gardes d\'E4.1 rendent désormais 500 au lieu de 403.'
        );
    }

    /**
     * Le DDL non plus, et c'est un arbitrage, pas un oubli.
     *
     * Le schéma NebulaGraph est asynchrone — d'où les trois `sleep()` de la migration
     * `create_nebula`. Une erreur transitoire (« Tag not found » pendant la propagation) y est
     * normale, et `IF NOT EXISTS` rend les relances idempotentes. Faire lever ferait échouer
     * `php artisan migrate` sur un space à moitié bâti, sans rollback exploitable.
     */
    #[Test]
    public function le_ddl_ne_leve_pas(): void
    {
        $connection = $this->fakeNebulaGraphConnection(
            (new FakeThriftClient)->failsWith(-1004, 'SyntaxError')
        );

        $this->assertInstanceOf(JsonResponse::class, $connection->createTag(['name' => 'comment', 'props' => []]));
    }

    /*
    |--------------------------------------------------------------------------
    | 4. Le journal — ce qui ferme réellement le trou d'observabilité
    |--------------------------------------------------------------------------
    */

    /**
     * La levée donne un contrat aux appelants ; le journal est ce qui rend les ~95 sites
     * visibles d'un coup, y compris ceux qui ne lèvent pas.
     */
    #[Test]
    public function une_ecriture_refusee_est_journalisee(): void
    {
        $connection = $this->fakeNebulaGraphConnection(
            (new FakeThriftClient)->failsWith(-1004, 'SyntaxError')
        );

        Log::spy();

        try {
            $connection->insertEdge('reply_of', ['c1->c2' => ['created_at' => 1]]);
        } catch (NebulaGraphException) {
            // La levée est l'objet d'un autre test ; ici seul le journal compte.
        }

        Log::shouldHaveReceived('error')
            ->withArgs(fn (string $message, array $context) => ($context['code'] ?? null) === -1004
                && ($context['operation'] ?? null) === 'insertEdge'
                && str_contains($context['query'] ?? '', 'INSERT EDGE'))
            ->once();
    }

    /**
     * Une lecture refusée ne lève pas — mais elle ne doit plus être muette pour autant.
     *
     * C'est ce qui aurait rendu visible le `SyntaxError` de `canJoinchatRoom`, resté invisible
     * pendant des mois : la requête ne s'exécutait jamais, et rien nulle part ne le disait.
     */
    #[Test]
    public function une_lecture_refusee_est_journalisee_sans_lever(): void
    {
        $connection = $this->fakeNebulaGraphConnection(
            (new FakeThriftClient)->failsWith(-1004, 'SyntaxError: Where clause in optional match is not supported')
        );

        Log::spy();

        $connection->execute('OPTIONAL MATCH (c:chat) WHERE id(c) == "chat42" RETURN c');

        // `'execute'` et non `'read'` : le DDL emprunte le même chemin non levant, l'étiquette
        // désigne donc le CHEMIN, pas la nature de la requête — que le contexte porte déjà.
        Log::shouldHaveReceived('error')
            ->withArgs(fn (string $message, array $context) => ($context['code'] ?? null) === -1004
                && ($context['operation'] ?? null) === 'execute'
                && str_contains($context['query'] ?? '', 'OPTIONAL MATCH'))
            ->once();
    }

    /**
     * Une réponse nominale ne journalise rien : sans quoi le journal crierait en continu et ne
     * signalerait plus rien. Même raisonnement que le « refus sans warning » d'E4.1.
     */
    #[Test]
    public function une_requete_nominale_ne_journalise_rien(): void
    {
        $connection = $this->fakeNebulaGraphConnection(new FakeThriftClient);

        Log::spy();

        $connection->execute('MATCH (u:user) RETURN u');
        $connection->insertEdge('reply_of', ['c1->c2' => ['created_at' => 1]]);

        Log::shouldNotHaveReceived('error');
    }

    /*
    |--------------------------------------------------------------------------
    | 5. La liste vide — la régression que la levée ferait naître
    |--------------------------------------------------------------------------
    */

    /**
     * `Feed::deleteFeedPost` supprime les commentaires d'un post SANS garder la liste vide
     * (`src/app/Services/Feed.php:281`), alors que la ligne d'à côté garde bien son
     * `count($share_ids)`. Sur un post sans commentaire, `deleteVertex([])` produit donc
     * `DELETE VERTEX  WITH EDGE` — une requête invalide, aujourd'hui absorbée en silence.
     *
     * Sans ce garde, E7 transformerait cette erreur parasite en 500 À CHAQUE suppression de post
     * sans commentaire. Le garde va dans la COUTURE et non à l'appel : « supprimer rien » est un
     * no-op, pas une erreur, et les quatre méthodes concernées héritent du même traitement.
     *
     * ⚠️ Postulat non vérifié contre un vrai cluster : que NebulaGraph refuse bien cette forme.
     * S'il l'accepte comme un no-op, le garde n'est qu'une ceinture — le comportement observable
     * est le même.
     */
    #[Test]
    public function supprimer_aucun_sommet_n_emet_aucune_requete(): void
    {
        $client = new FakeThriftClient;
        $connection = $this->fakeNebulaGraphConnection($client);

        $this->assertSame([], $connection->deleteVertex([], true));
        $this->assertSame([], $client->statements(), 'Un nGQL malformé est parti pour ne rien supprimer.');
    }

    #[Test]
    public function supprimer_aucune_arete_n_emet_aucune_requete(): void
    {
        $client = new FakeThriftClient;
        $connection = $this->fakeNebulaGraphConnection($client);

        $this->assertSame([], $connection->deleteEdge('registered_in', []));
        $this->assertSame([], $client->statements());
    }

    /*
    |--------------------------------------------------------------------------
    | 6. Le nGQL construit — ce que seule la vraie classe peut montrer
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function l_insertion_de_sommet_construit_la_requete_attendue(): void
    {
        $client = new FakeThriftClient;
        $connection = $this->fakeNebulaGraphConnection($client);

        $connection->insertVertex('comment', ['id' => 'c1', 'content' => 'bonjour']);

        $this->assertStringContainsString('INSERT VERTEX IF NOT EXISTS comment', $client->lastStatement());
        $this->assertStringContainsString('"c1":', $client->lastStatement());
        $this->assertStringContainsString("'bonjour'", $client->lastStatement());
        // `created_at` est ajouté par la couture, pas par l'appelant.
        $this->assertStringContainsString('datetime()', $client->lastStatement());
    }
}
