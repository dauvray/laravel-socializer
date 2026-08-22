<?php

namespace Dauvray\Socializer\Tests\Feature\Chat;

use Dauvray\Socializer\app\Http\Resources\Message as MessageResource;
use Dauvray\Socializer\app\Http\Resources\MessageAuthor;
use Dauvray\Socializer\Tests\Stubs\User;
use Dauvray\Socializer\Tests\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

/**
 * E9 — la charge utile d'un AUTEUR de message ne porte que ce que le fil affiche.
 *
 * Même famille qu'E8, autre vecteur. `filterSensibleDataUserRessource()` filtrait l'auteur par une
 * LISTE NOIRE : elle retirait `email`, `created_at`, `roles`, `permissions` et `channel`, mais
 * laissait passer `groups` (avec son `server_id`) et `unreadNotifications` — vers tous les membres
 * du chat sur `receivedMsg`/`updatedMsg`, et vers le destinataire sur
 * `NewChatMessageNotification`. Elle avait été écrite avant que `Resources\User` n'ajoute son
 * propre `groups`, **sans condition** (`src/app/Http/Resources/User.php:61-67`) : une seconde
 * source qu'une liste noire ne pouvait pas connaître.
 *
 * D'où `MessageAuthor`, liste blanche de six champs, sur le patron de `PresenceUser`. C'est la
 * leçon d'E8 réappliquée : **sur un chemin de diffusion, une liste blanche est le seul filtre qui
 * vieillisse bien.**
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS.
 *
 *  1. **Le câblage des deux sites de diffusion.** `Chat::createAndDispatchMessage` est privée et
 *     `Chat::updateMessage` exige Mongo, NebulaGraph et Redis : injouable sous Testbench, pour la
 *     même raison qui fait qu'`ChatRegistrationTest` évite `getOrcreateChatVertice`. Seul le
 *     troisième site, `Resources\Message` (l'historique HTTP), est épinglé ici — le reste se
 *     vérifie à la lecture et dans l'inspecteur réseau.
 *  2. **L'ancienne fuite elle-même.** Écrit contre `filterSensibleDataUserRessource`, un test
 *     n'aurait pas ÉCHOUÉ : il aurait planté en `Error: Class
 *     "Dauvray\Estarter\app\Http\Resources\User" not found`, exactement comme E8 avant son
 *     correctif — le harnais ne sait pas construire une ressource d'un autre paquet. La
 *     démonstration du défaut est le relevé mesuré ci-dessus, pas un rouge.
 */
class AuthorPayloadTest extends TestCase
{
    /**
     * Le bloc privé d'estarter, le `groups` inconditionnel de `Resources\User`, et les champs que
     * ce contexte rend inutiles ou trompeurs : `is_me` (l'auteur d'un message est rarement le
     * lecteur), `channel` (le canal privé du sujet), `auth_provider` (il vaut le nom du DEMANDEUR,
     * pas celui du sujet), plus les champs de profil que seul un mur lit.
     *
     * @return array<string, array{0: string}>
     */
    public static function champsQuiNeDoiventPlusSortir(): array
    {
        return [
            'groups' => ['groups'],
            'unreadNotifications' => ['unreadNotifications'],
            'email' => ['email'],
            'roles' => ['roles'],
            'permissions' => ['permissions'],
            'created_at' => ['created_at'],
            'channel' => ['channel'],
            'is_me' => ['is_me'],
            'auth_provider' => ['auth_provider'],
            'identifier' => ['identifier'],
            'vertexid' => ['vertexid'],
            'cover' => ['cover'],
            'nb_followers' => ['nb_followers'],
        ];
    }

    /**
     * Les six champs que le fil de discussion lit réellement sur un auteur — relevé du 22/08/2026,
     * fait pour E9 : `slug` (`MessageWidget` et `MessageTools` en tirent l'alignement « moi » et
     * l'accès aux outils d'édition ; `GravatarStatus` s'y abonne), `name` et `image` (`Gravatar`,
     * `WallLink`), `function` (`WallLink`), `connected` (`GravatarStatus`, dès qu'aucun listener
     * `users-status.{slug}` n'existe — le cas ordinaire), `id` (`WallLink.canSendMessage`).
     *
     * Identique au périmètre de `PresenceUser`, et ce n'est pas une raison de fusionner les deux :
     * ce sont deux contrats, sur deux surfaces, libres de diverger.
     */
    private const CHAMPS_ATTENDUS = ['id', 'name', 'slug', 'image', 'function', 'connected'];

    protected function setUp(): void
    {
        parent::setUp();

        // `connected` est le seul champ que la ressource ne lit pas sur le modèle : il vient du
        // service de présence d'estarter, absent du harnais.
        $this->fakeOnlineUsers();
    }

    /**
     * `resolve()` et non `toArray()` : c'est lui qui filtre les `MissingValue` d'un
     * `$this->when(…)`, donc la seule lecture qui dise vraiment quelles clés sortent.
     *
     * @return array<string, mixed>
     */
    private function chargeUtileDe(User $auteur): array
    {
        return (new MessageAuthor($auteur))->resolve();
    }

    /*
    |--------------------------------------------------------------------------
    | 1. Ce qui ne doit plus sortir
    |--------------------------------------------------------------------------
    */

    /**
     * `actingAs($auteur)` n'est pas décoratif : c'est le contexte du défaut. Sur `updatedMsg`
     * l'auteur EST toujours l'éditeur authentifié, et sur `receivedMsg` il l'est dans le cas
     * ordinaire — le garde `if ($this->id === Auth::user()?->id)` d'estarter concluait donc « c'est
     * moi » et livrait le bloc privé à toute la room. Un test authentifié comme un tiers verdirait
     * sur l'ancien code sans avoir rien exercé.
     */
    #[Test]
    #[DataProvider('champsQuiNeDoiventPlusSortir')]
    public function la_charge_utile_d_auteur_ne_porte_pas_le_bloc_prive(string $champ): void
    {
        $auteur = $this->makeUser('camille'.strtolower($champ));

        $this->actingAs($auteur);

        $this->assertArrayNotHasKey(
            $champ,
            $this->chargeUtileDe($auteur),
            "`$champ` repart vers tous les membres du chat avec chaque message."
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 2. Ce qui doit continuer à sortir
    |--------------------------------------------------------------------------
    */

    /**
     * `assertSame` sur les clés, et non un simple « contient » : tout champ ajouté ici devra être
     * une décision, pas un héritage.
     */
    #[Test]
    public function la_charge_utile_d_auteur_garde_ce_que_le_fil_affiche(): void
    {
        $auteur = $this->makeUser('diane');

        $this->actingAs($auteur);

        $charge = $this->chargeUtileDe($auteur);

        $this->assertSame(self::CHAMPS_ATTENDUS, array_keys($charge));
        $this->assertSame($auteur->id, $charge['id']);
        $this->assertSame($auteur->name, $charge['name']);
        $this->assertSame($auteur->slug, $charge['slug']);
    }

    /**
     * `image` et `function` ne sont pas des colonnes du modèle du harnais : sans ce test, les deux
     * clés seraient présentes et vides, et une ressource qui ne les lirait plus du tout resterait
     * verte. Ici on observe le RELAIS, pas la présence de la clé.
     */
    #[Test]
    public function l_avatar_et_la_fonction_sont_relayes_tels_quels(): void
    {
        $auteur = $this->makeUser('émile');

        $auteur->image = ['small' => 'avatar-small.png', 'medium' => 'avatar-medium.png'];
        $auteur->function = 'Ergothérapeute';

        $charge = $this->chargeUtileDe($auteur);

        $this->assertSame(['small' => 'avatar-small.png', 'medium' => 'avatar-medium.png'], $charge['image']);
        $this->assertSame('Ergothérapeute', $charge['function']);
    }

    /**
     * Les deux réponses sont assertées — une doublure qui rendrait toujours 0 ferait verdir la
     * moitié de ce fichier sans rien observer.
     */
    #[Test]
    public function connected_reflete_le_service_de_presence(): void
    {
        $enLigne = $this->makeUser('fabienne');
        $horsLigne = $this->makeUser('gaspard');

        $this->fakeOnlineUsers()->pretendOnline($enLigne->id);

        $this->assertSame(1, $this->chargeUtileDe($enLigne)['connected']);
        $this->assertSame(0, $this->chargeUtileDe($horsLigne)['connected']);
    }

    /*
    |--------------------------------------------------------------------------
    | 3. La leçon, épinglée
    |--------------------------------------------------------------------------
    */

    /**
     * Le fait durable, jumeau de celui d'E8 : **le périmètre d'une ressource de diffusion se décide
     * dans la ressource, jamais dans l'identité de la requête qui l'a fabriquée.** Ce test interdit
     * le retour d'une ressource à géométrie variable sur une charge utile d'auteur, quelle que soit
     * la façon dont elle décide son périmètre.
     */
    #[Test]
    public function le_perimetre_ne_depend_pas_de_l_identite_de_la_requete(): void
    {
        $auteur = $this->makeUser('hortense');
        $lecteur = $this->makeUser('isidore');

        $this->actingAs($auteur);
        $vueParLuiMeme = $this->chargeUtileDe($auteur);

        $this->actingAs($lecteur);
        $vueParUnTiers = $this->chargeUtileDe($auteur);

        $this->assertSame($vueParLuiMeme, $vueParUnTiers);
    }

    /*
    |--------------------------------------------------------------------------
    | 4. Le câblage de l'historique HTTP
    |--------------------------------------------------------------------------
    */

    /**
     * L'historique (`GET /load-conversation`) et la diffusion alimentent les MÊMES bindings côté
     * front (`item.author`). `Resources\Message` renvoyait pourtant `Resources\User` sans aucun
     * filtre : `groups` avec son `server_id` sortait à chaque chargement de conversation. Les deux
     * surfaces doivent donner la même forme, sinon la plus permissive redevient la vraie.
     *
     * Le message est un objet nu et non un modèle Mongo : `Resources\Message` ne lit que cinq
     * attributs, et aucune table de chat n'existe dans le harnais.
     */
    #[Test]
    public function l_historique_http_expose_le_meme_auteur_que_la_diffusion(): void
    {
        $auteur = $this->makeUser('joséphine');

        $this->actingAs($auteur);

        $message = (object) [
            'message' => 'Bonjour',
            'created_at' => '2026-08-22 12:00:00',
            'model_id' => $auteur->id,
            'vertexid' => 'message42',
            'extras' => [],
        ];

        $charge = (new MessageResource($message))->resolve();

        $this->assertInstanceOf(
            MessageAuthor::class,
            $charge['author'],
            'L\'historique HTTP renvoie encore une ressource à géométrie variable.'
        );

        $this->assertSame(self::CHAMPS_ATTENDUS, array_keys($charge['author']->resolve()));
    }
}
