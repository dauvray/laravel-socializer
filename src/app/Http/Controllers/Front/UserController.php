<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use Illuminate\Support\Facades\Auth;
use Illuminate\Http\Request;
use App\Http\Controllers\Controller;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Dauvray\Socializer\app\Http\Resources\User as UserResource;
use Dauvray\Socializer\app\Services\Users as UserService;

class UserController extends Controller
{
    public function getUserData(Request $request, $user_id = null)
    { 
        $user = Auth::user();

        if($user_id && $user->can('list_users')) {
            return response()->json([
                'user' => new UserResource( config('estarter.models.user')::findOrFail($user_id) )
            ]);
        }

        return response()->json(['user' => new UserResource($user)]);
    }

    public function getUsersList(Request $request, UserService $service)
    {
        $user = Auth::user();

        // if(!$user->can('list_users')) {
        //     return response()->json(['message' => 'Vous n\'avez pas la permission de lister les utilisateurs'], 403);
        // }

        return response()->json( $service->getUsersList($request->route()->getName()), 200);
    }

    public function followUser(Request $request, UserService $service)
    {
        $user_tofollow = revealIdentifier($request->get('identifier'));

        if($service->followUser($user_tofollow)) {
            return response()->json(['message' => 'Vous suivez maintenant '.$user_tofollow->name, 'status' => 'success'], 200);
        } else {
            return response()->json(['message' => 'Opération impossible', 'status' => 'error'], 500);
        }
    }

    public function unfollowUser(Request $request, UserService $service)
    {
        $user_followed = revealIdentifier($request->get('identifier'));

        if($service->unfollowUser($user_followed)) {
            return response()->json(['message' => 'Vous ne suivez plus '.$user_followed->name, 'status' => 'success'] , 200);
        } else {
            return response()->json(['message' => 'Opération impossible', 'status' => 'error'], 500);
        }

    }

    public function updateAvatar(Request $request)
    {
        $user = Auth::user();
        $user->image = $request->file('file');
        $user->save();
        return response()->json($user->image, 200);
    }

    public function updateCover(Request $request)
    {
        $user = Auth::user();
        $user->setCoverImage($request->file('file'));
        $user->save();
        return response()->json($user->extras['cover'], 200);
    }
    
    /*-----------------------------------------------
    | SIGNALING
    _________________________________________________*/

    /**
     * Types de connexion relayables — miroir EXACT de `VALID_CONNECTION_TYPES`
     * (`webrtc2.config.js`). Constante de classe et non entrée de config : c'est un
     * **contrat** partagé avec le front, pas un réglage. Un hôte qui l'élargirait
     * desserrerait une liste blanche de sécurité sans toucher au JS qui la reflète — à
     * l'inverse des plafonds de C1, légitimement ajustables en production.
     *
     * `ValidationTest::la_liste_blanche_php_reflete_le_front` relit le fichier JS et
     * compare : la divergence est rouge, jamais silencieuse.
     */
    private const VALID_CONNECTION_TYPES = ['data', 'stream', 'screen', 'visio', 'vocal'];

    /** Format d'un slug utilisateur — miroir de `SLUG_PATTERN` (`webrtc2.config.js`). */
    private const SLUG_PATTERN = '/^[a-zA-Z0-9_\-.]{1,100}$/';

    /**
     * Actions d'invitation reconnues. Une seule aujourd'hui : c'est la seule clé de
     * `mappingComponents` dans `System/widgets/AlertComponent.vue`, qui déréférence
     * `mappingComponents[options.action][options.type]` sans garde — une action inconnue y
     * lève un TypeError chez le destinataire.
     */
    private const VALID_INVITE_ACTIONS = ['peer-access-permission'];

    /**
     * Clés d'`options` relayées. `options` est le SEUL champ transmis verbatim : sans cette
     * liste, un émetteur y place ce qu'il veut, de la taille qu'il veut, chez la victime.
     * Ce sont exactement les clés lues côté client — `type`/`room`/`peerId`/`inviteId` par
     * `useCallManager`, `action`/`type` par `Notifications.vue` et `AlertComponent.vue`.
     */
    private const RELAYED_OPTION_KEYS = ['type', 'action', 'room', 'peerId', 'inviteId'];

    /**
     * Borne des identifiants relayés tels quels (`room`, `inviteId`). Volontairement une
     * longueur et **aucun motif** : `room` vaut tantôt un `crypto.randomUUID()`, tantôt
     * `'app'`, tantôt un `room.id` de l'application hôte — il n'y a pas de forme commune.
     */
    private const MAX_RELAYED_ID_LENGTH = 100;

    /**
     * Règles d'un slug utilisateur venu du réseau.
     */
    private function slugRules(bool $required = true): array
    {
        return [$required ? 'required' : 'nullable', 'string', 'regex:'.self::SLUG_PATTERN];
    }

    /**
     * Règles d'un identifiant de room relayé.
     */
    private function roomRules(bool $required = true): array
    {
        return [$required ? 'required' : 'nullable', 'string', 'max:'.self::MAX_RELAYED_ID_LENGTH];
    }

    /**
     * Règles d'un type de connexion relayé.
     */
    private function typeRules(bool $required = true): array
    {
        return [$required ? 'required' : 'nullable', 'string', Rule::in(self::VALID_CONNECTION_TYPES)];
    }

    /**
     * Règles du bloc `options` des deux routes d'invitation d'appel.
     *
     * `$actionRequired` sépare les deux sens de l'échange : l'invitation porte toujours son
     * `action`, alors qu'un REFUS n'envoie que `{ type }` (`usePeerCore::sendAuthorizationRemotePeerId`
     * — « on envoie les infos de connexion seulement si l'accès est autorisé »). L'exiger
     * des deux côtés casserait le refus d'appel.
     */
    private function optionsRules(bool $actionRequired): array
    {
        return [
            'options' => ['required', 'array'],
            'options.type' => $this->typeRules(),
            'options.action' => [
                $actionRequired ? 'required' : 'nullable',
                'string',
                Rule::in(self::VALID_INVITE_ACTIONS),
            ],
            'options.room' => $this->roomRules(false),
            // Nullable, pas required : `getLocalPeerId` peut être null quand l'invitation
            // part avant que le peer local ne soit ouvert.
            'options.peerId' => ['nullable', 'uuid'],
            'options.inviteId' => ['nullable', 'string', 'max:'.self::MAX_RELAYED_ID_LENGTH],
        ];
    }

    /**
     * Réduit `options` aux clés relayables.
     *
     * Redondant avec `Factory::$excludeUnvalidatedArrayKeys` (vrai par défaut, donc
     * `validate()` écarte déjà les clés non nommées) — mais un hôte qui appelle
     * `Validator::includeUnvalidatedArrayKeys()` rouvrirait le relais **en silence**. Le
     * rendre explicite met la liste blanche sous les yeux de qui relit le `->with()`.
     */
    private function relayedOptions(array $validated): array
    {
        return Arr::only((array) ($validated['options'] ?? []), self::RELAYED_OPTION_KEYS);
    }

    /*
    | Ask PeerId to an user
    */
    public function askForPeerId(Request $request)
    {
        // ⚠️ AVANT la résolution du destinataire et surtout HORS du `try` :
        // `ValidationException` étend `\Exception`, donc un `validate()` posé à l'intérieur
        // repartirait en 500 par `signalingFailure()`. Même règle dans les quatre méthodes
        // suivantes, et même raison pour le garde de relation qui suit.
        $data = $request->validate([
            'toUserSlug' => $this->slugRules(),
            'room' => $this->roomRules(),
            'type' => $this->typeRules(),
            // Nullable : le module WebRTC v1 ne l'envoie pas, et le repli `connectionType
            // || type` est un choix documenté de rétrocompatibilité côté client.
            'connectionType' => $this->typeRules(false),
        ]);

        $to = config('estarter.models.user')::where('slug', $data['toUserSlug'])->first();
        $user = Auth::user();

        if (! $to || ! $user->mayReach($to)) {
            return $this->signalingDenied($request, $data['toUserSlug'], $to !== null);
        }

        try {
            Broadcast::private('App.Models.User.'.$to->id)
            ->as('AskToPeerID')
            ->with([
                'room' => $data['room'],
                // `type` = type du CONTEXTE côté client : c'est la clé de routage du
                // signal (Notifications.vue en dérive `roomId`). Ne jamais y mettre
                // 'screen', qui n'a pas de contexte à lui.
                'type' => $data['type'],
                // `connectionType` = type de connexion réellement demandé ('screen'…).
                // Champ distinct pour que le partage d'écran passe par la signalisation
                // au lieu de dépendre uniquement du moteur de retry côté client.
                'connectionType' => $data['connectionType'] ?? null,
                'fromUserSlug' => $user->slug,
            ])
            ->sendNow();
        }
        catch (\Exception $ex) {
            return $this->signalingFailure($ex, $request);
        }
    }

    /*
    | Return peer id to user who asked it
    */
    public function responseToPeerId(Request $request)
    {
        $data = $request->validate([
            'toUserSlug' => $this->slugRules(),
            // Les peerId sont générés par le serveur PeerJS (`new Peer({…})` sans id
            // imposé) : ce sont des UUID. Requis, parce qu'un `peerId` nul rend la réponse
            // inutilisable — le client pose déjà la garde symétrique avant d'émettre.
            'peerId' => ['required', 'uuid'],
            'room' => $this->roomRules(),
            'type' => $this->typeRules(),
            'connectionType' => $this->typeRules(false),
        ]);

        $to = config('estarter.models.user')::where('slug', $data['toUserSlug'])->first();
        $user = Auth::user();

        if (! $to || ! $user->mayReach($to)) {
            return $this->signalingDenied($request, $data['toUserSlug'], $to !== null);
        }

        try {
            Broadcast::private('App.Models.User.'.$to->id)
            ->as('ResponseToPeerID')
            ->with([
                'peerId' => $data['peerId'],
                'fromUserSlug' => $user->slug,
                // Cf. askForPeerId : `type` route le signal, `connectionType` porte le
                // type de connexion à ouvrir. Renvoyés tels que reçus.
                'type' => $data['type'],
                'connectionType' => $data['connectionType'] ?? null,
                'room' => $data['room'],
            ])
            ->sendNow();
        }
        catch (\Exception $ex) {
            return $this->signalingFailure($ex, $request);
        }
    }

    public function responseToPeerAuthorization(Request $request)
    {
        $data = $request->validate(array_merge([
            'toUserSlug' => $this->slugRules(),
            'status' => ['required', 'boolean'],
        ], $this->optionsRules(actionRequired: false)));

        $to = config('estarter.models.user')::where('slug', $data['toUserSlug'])->first();
        $user = Auth::user();

        if (! $to || ! $user->mayReach($to)) {
            return $this->signalingDenied($request, $data['toUserSlug'], $to !== null);
        }

        try {
            Broadcast::private('App.Models.User.'.$to->id)
            ->as('ResponseToAuthorizationPeer')
            ->with([
                'options' =>  $this->relayedOptions($data),
                // Relayé brut, comme avant : le client envoie un vrai booléen JSON, et le
                // caster ici changerait la valeur reçue par le destinataire.
                'status' => $data['status'],
                'fromUserSlug' => $user->slug,
            ])
            ->sendNow();
        }
        catch (\Exception $ex) {
            return $this->signalingFailure($ex, $request);
        }
    }

    public function closeConnectionToPeerId(Request $request)
    {
        $data = $request->validate([
            'toUserSlug' => $this->slugRules(),
            // Purement déclaratif — il ne sert qu'au journal d'usurpation ci-dessous, le
            // slug diffusé étant toujours celui de l'authentifié. Nullable, donc, mais bien
            // contraint en forme : un champ non validé finirait tel quel dans les logs.
            'fromUserSlug' => $this->slugRules(false),
            'room' => $this->roomRules(),
            'type' => $this->typeRules(),
        ]);

        $to = config('estarter.models.user')::where('slug', $data['toUserSlug'])->first();
        $user = Auth::user();

        if (! $to || ! $user->mayReach($to)) {
            return $this->signalingDenied($request, $data['toUserSlug'], $to !== null);
        }

        $claimedSlug = $data['fromUserSlug'] ?? null;
        if ($claimedSlug !== null && $claimedSlug !== '' && $claimedSlug !== $user->slug) {
            Log::warning('Tentative d\'usurpation fromUserSlug dans closeConnectionToPeerId', [
                'auth_user_id' => $user->id,
                'auth_user_slug' => $user->slug,
                'claimed_slug' => $claimedSlug,
                'target_slug' => $data['toUserSlug'],
                'ip' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);
        }

        try {
            Broadcast::private('App.Models.User.'.$to->id)
            ->as('CloseConnectionToPeerID')
            ->with([
                'fromUserSlug' => $user->slug,
                'room' => $data['room'],
                'type' => $data['type'],
            ])
            ->sendNow();
        }
        catch (\Exception $ex) {
            return $this->signalingFailure($ex, $request);
        }
    }

    public function sendAlertToUser(Request $request)
    {
        $data = $request->validate(array_merge([
            'toUserSlug' => $this->slugRules(),
        ], $this->optionsRules(actionRequired: true)));

        $to = config('estarter.models.user')::where('slug', $data['toUserSlug'])->first();
        $user = Auth::user();

        if (! $to || ! $user->mayReach($to)) {
            return $this->signalingDenied($request, $data['toUserSlug'], $to !== null);
        }

        try {
            Broadcast::private('App.Models.User.'.$to->id)
            ->as('AlertToUser')
            ->with([
                'options' =>  $this->relayedOptions($data),
                'fromUserSlug' => $user->slug,
            ])
            ->sendNow();
        }
        catch (\Exception $ex) {
            return $this->signalingFailure($ex, $request);
        }
    }

    /**
     * Échec de broadcast sur une route de signalisation : journaliser, ne rien divulguer.
     *
     * Les 5 méthodes ci-dessus faisaient `return $ex;`. Ce n'est pas un simple bavardage :
     * le routeur ne sait pas quoi faire d'un objet quelconque, alors il le confie à
     * `Response::setContent`, qui accepte tout ce qui est `__toString()`-able — et
     * `Throwable::__toString()` rend le message, LE CHEMIN DU FICHIER, la ligne et LA TRACE
     * COMPLÈTE. Le tout en **200**, donc le client croyait avoir signalé, et
     * **indépendamment d'`APP_DEBUG`** (qui ne gouverne que le rendu du handler d'exceptions,
     * jamais une valeur retournée volontairement par un contrôleur).
     *
     * Point unique plutôt que cinq blocs recopiés : le nom de la route suffit à discriminer,
     * et un format de log unique reste lisible en production. Contexte calqué sur le
     * `Log::warning` d'usurpation de `closeConnectionToPeerId`.
     */
    private function signalingFailure(\Exception $ex, Request $request)
    {
        $user = Auth::user();

        Log::error('Échec de broadcast sur une route de signalisation', [
            'route' => $request->route()?->getName(),
            'auth_user_id' => $user?->id,
            'auth_user_slug' => $user?->slug,
            'target_slug' => $request->get('toUserSlug'),
            'ip' => $request->ip(),
            'exception' => $ex,
        ]);

        return response()->json(['ok' => false], 500);
    }

    /**
     * Signalisation refusée par le garde de relation (C2).
     *
     * Deux causes, UNE seule réponse. Le `firstOrFail` d'avant renvoyait 404 sur un slug
     * inconnu et le garde renverrait 403 sur une absence de relation : la différence est un
     * oracle d'énumération, un attaquant distingue les slugs qui existent en les sondant. Le
     * journal, lui, garde la distinction — il n'est pas exposé.
     *
     * Vérifié avant de changer le code : aucun composable WebRTC2 n'inspecte le statut HTTP,
     * tous ces appels sont dans un `catch` nu. Le passage de 404 à 403 est invisible côté
     * client.
     *
     * Contexte calqué sur le `Log::warning` d'usurpation de `closeConnectionToPeerId`.
     */
    private function signalingDenied(Request $request, string $targetSlug, bool $targetExists)
    {
        $user = Auth::user();

        Log::warning('Signalisation refusée : aucune relation entre émetteur et destinataire', [
            'route' => $request->route()?->getName(),
            'auth_user_id' => $user?->id,
            'auth_user_slug' => $user?->slug,
            'target_slug' => $targetSlug,
            'target_exists' => $targetExists,
            'ip' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json(['ok' => false], 403);
    }
}