<?php

namespace Dauvray\Socializer\app\Exceptions;

use Illuminate\Support\Str;

/**
 * Une écriture dans le graphe a été refusée par NebulaGraph.
 *
 * Levée par les 6 méthodes DML de `NebulaGraphConnection` — et par elles seules. Les lectures et
 * le DDL se contentent du journal : cf. l'en-tête de `NebulaGraphConnection` pour l'asymétrie et
 * ses raisons.
 *
 * Elle étend `RuntimeException` et non `Exception` directement, parce que deux chemins par lot
 * rattrapent déjà `\Exception` (`Jobs/SendPostToFollowers`, `console/Commands/NebulaGraphPopulate`)
 * et doivent continuer de le faire sans être touchés.
 *
 * ⚠️ DEUX RÈGLES QUI NE SE DEVINENT PAS.
 *
 * 1. NI LA REQUÊTE NI LE MESSAGE DU GRAPHE NE VONT DANS `getMessage()`. Le nGQL porte du contenu
 *    utilisateur après `VALUES` — corps de commentaire, titre de chat —, et le message d'erreur de
 *    NebulaGraph en cite volontiers un fragment (« syntax error near … »). Or hors
 *    `UserController` aucun contrôleur du paquet n'a de `try/catch`, et `APP_DEBUG` est vrai en
 *    dev : un `getMessage()` bavard se retrouverait dans un corps 500 lu par le front. C'est la
 *    leçon C3 appliquée en amont. Le diagnostic complet sort par `nebulaMessage()`, `query()` et
 *    le journal — jamais par la réponse HTTP.
 *
 * 2. `getCode()` VAUT TOUJOURS 0. Les codes nGQL sont négatifs (-1004 `SyntaxError`, -1005
 *    `SemanticError`) et plusieurs renderers d'exception lisent `getCode()` comme un statut HTTP.
 *    Le code du graphe vit dans `nebulaCode()`.
 */
final class NebulaGraphException extends \RuntimeException
{
    private function __construct(
        string $message,
        private readonly string $operation,
        private readonly int $nebulaCode,
        private readonly string $nebulaMessage,
        private readonly string $query,
    ) {
        parent::__construct($message, 0);
    }

    /**
     * @param  string  $operation  la méthode DML refusée — `insertEdge`, `deleteVertex`, …
     * @param  string  $query  le nGQL complet, pour le journal et le diagnostic
     */
    public static function writeRefused(string $operation, int $code, string $message, string $query): self
    {
        return new self(
            // Volontairement pauvre : cf. règle 1 de l'en-tête.
            sprintf('%s refusé par NebulaGraph (code %d).', $operation, $code),
            $operation,
            $code,
            $message,
            $query,
        );
    }

    /**
     * La charge de journal, définie UNE fois pour les lectures comme pour les écritures.
     *
     * `NebulaGraphConnection` l'appelle directement pour les chemins qui ne lèvent pas (lectures,
     * DDL) ; les appelants qui rattrapent l'exception réutilisent `context()`. Une seule forme,
     * donc des journaux comparables entre les deux.
     *
     * La requête est TRONQUÉE : les erreurs de syntaxe se voient dans le préfixe, alors que le
     * contenu utilisateur arrive après `VALUES` — un journal complet finirait par recopier des
     * corps de messages à chaque incident.
     *
     * @return array{operation: string, code: int, message: string, query: string}
     */
    public static function contextFor(string $operation, int $code, string $message, ?string $query): array
    {
        return [
            'operation' => $operation,
            'code' => $code,
            'message' => $message,
            'query' => Str::limit((string) $query, 300),
        ];
    }

    /** @return array{operation: string, code: int, message: string, query: string} */
    public function context(): array
    {
        return self::contextFor($this->operation, $this->nebulaCode, $this->nebulaMessage, $this->query);
    }

    public function operation(): string
    {
        return $this->operation;
    }

    public function nebulaCode(): int
    {
        return $this->nebulaCode;
    }

    public function nebulaMessage(): string
    {
        return $this->nebulaMessage;
    }

    public function query(): string
    {
        return $this->query;
    }
}
