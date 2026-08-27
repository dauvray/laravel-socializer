<?php

namespace Dauvray\Socializer\Tests\Feature\Signaling;

use Dauvray\Socializer\Tests\Stubs\User;

/**
 * Les 5 routes de signalisation et leur payload nominal, calqués sur ce que `usePeerCore` et
 * `useCallManager` envoient réellement — jamais sur une intuition de forme.
 *
 * Partagé entre les fichiers du lot C : chacun teste un garde différent (validation, relation),
 * mais tous ont besoin du même « ce que le client envoie vraiment ». Une seule copie, donc :
 * si le client change, un seul endroit ment.
 */
trait SignalingPayloads
{
    /** Un peerId réaliste : le serveur PeerJS génère des UUID. */
    private const PEER_ID = '550e8400-e29b-41d4-a716-446655440000';

    /** Une room d'appel réaliste : `ensureCurrentCallRoomId` fait `crypto.randomUUID()`. */
    private const CALL_ROOM = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

    private const INVITE_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function signalingRoutes(): array
    {
        return [
            'askForPeerId' => ['/ask-to-peer-id', 'AskToPeerID'],
            'responseToPeerId' => ['/response-to-peer-id', 'ResponseToPeerID'],
            'sendAlertToUser' => ['/send-alert-to-user', 'AlertToUser'],
            'responseToPeerAuthorization' => ['/response-to-authorization-peer', 'ResponseToAuthorizationPeer'],
            'closeConnectionToPeerId' => ['/close-connection-to-peer-id', 'CloseConnectionToPeerID'],
        ];
    }

    /**
     * Le payload nominal d'une route, calqué sur `usePeerCore`.
     */
    protected function nominalPayload(string $uri, User $to, User $from): array
    {
        $callOptions = [
            'type' => 'visio',
            'action' => 'peer-access-permission',
            'room' => self::CALL_ROOM,
            'peerId' => self::PEER_ID,
            'inviteId' => self::INVITE_ID,
        ];

        return match ($uri) {
            '/ask-to-peer-id' => [
                'toUserSlug' => $to->slug,
                'room' => 'app',
                'type' => 'stream',
                // Le cas du partage d'écran : `type` reste celui du contexte, seul
                // `connectionType` vaut 'screen'.
                'connectionType' => 'screen',
                // Un vrai booléen JSON, comme `usePeerCore` l'envoie : la règle `boolean`
                // de Laravel refuserait la chaîne "true".
                'isBroadcasting' => true,
            ],
            '/response-to-peer-id' => [
                'toUserSlug' => $to->slug,
                'peerId' => self::PEER_ID,
                'room' => 'app',
                'type' => 'stream',
                'connectionType' => 'screen',
                'isBroadcasting' => true,
            ],
            '/send-alert-to-user' => [
                'toUserSlug' => $to->slug,
                'options' => $callOptions,
            ],
            '/response-to-authorization-peer' => [
                'toUserSlug' => $to->slug,
                'status' => true,
                'options' => $callOptions,
            ],
            '/close-connection-to-peer-id' => [
                'toUserSlug' => $to->slug,
                'fromUserSlug' => $from->slug,
                'room' => 'app',
                'type' => 'visio',
            ],
        };
    }
}
