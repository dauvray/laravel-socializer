<?php

/**
 * Helpers globaux d'estarter que le harnais doit fournir lui-même.
 *
 * POURQUOI. Le paquet appelle des fonctions globales définies dans `innovation/laravel-estarter`
 * (`src/app/Helpers/Utils.php`), et le `composer.json` d'ici ne déclare pas estarter — décision
 * assumée du harnais, cf. l'en-tête de `TestCase`. Les CLASSES d'estarter sont doublées sous
 * `tests/Stubs/Estarter/` via l'autoload PSR-4 ; les FONCTIONS, elles, n'ont pas d'autre point
 * d'accroche que ce fichier, chargé par `autoload-dev.files`.
 *
 * ⚠️ Chaque doublure est sous `function_exists` : en production ce sont celles d'estarter qui
 * gagnent, chargées avant. Et elles ne doublent que la FORME — une valeur du bon type, stable,
 * inspectable. Un test qui aurait besoin du vrai chiffrement ne peut pas s'appuyer sur ce fichier.
 */

if (!function_exists('hideIdentifier')) {
    /**
     * En production : un jeton chiffré, base64 et urlencodé, de `{model, id}`.
     * Ici : la même information, en clair et lisible dans une assertion.
     */
    function hideIdentifier($item)
    {
        return 'identifiant-'.strtolower(class_basename($item)).'-'.$item->id;
    }
}

if (!function_exists('getClassNameFromNamespace')) {
    /**
     * Le nom de classe court, dont `getVertexId()` déduit le tag du sommet (`group1`, `article1`).
     *
     * Reprend le `str_replace('Estarter', '')` de l'original : il fait que `EstarterUser` rend
     * `User`, donc `tags.user.name`. Sans lui, un modèle du socle chercherait un tag inexistant.
     */
    function getClassNameFromNamespace($input)
    {
        if (!is_string($input) && !is_object($input)) {
            throw new InvalidArgumentException("L'argument doit être une chaîne de caractères ou un objet.");
        }

        $path = explode('\\', is_string($input) ? $input : get_class($input));

        return str_replace('Estarter', '', end($path));
    }
}

if (!function_exists('uniqidReal')) {
    /**
     * En production : `bin2hex(random_bytes())`. Ici : une suite stable et RECONNAISSABLE.
     *
     * C'est ce qui permet à un test de distinguer « le sommet a reçu un id dérivé » de « le sommet
     * est retombé sur un id tiré au hasard » — la distinction même que corrige l'idempotence de
     * `createUserAndNetwork`.
     */
    function uniqidReal($lenght = 13)
    {
        static $compteur = 0;

        return substr('idaleatoire'.(++$compteur).str_repeat('0', $lenght), 0, $lenght);
    }
}
