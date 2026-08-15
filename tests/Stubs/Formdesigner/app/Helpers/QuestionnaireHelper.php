<?php

namespace Innovation\formdesigner\app\Helpers;

/**
 * Doublure INERTE de `QuestionnaireHelper` d'`innovation/laravel-formdesigner`.
 *
 * Même motif que `Dauvray\Estarter\...\Thumbnails` : le paquet appartient à une famille dont
 * les membres vivent dans un GitLab privé, et `ServiceProvider::boot` charge d'office tous les
 * `src/app/Helpers/*.php` — dont `SocializerQuestionnaireHelper`, qui étend cette classe.
 * Sans elle, l'application de test ne démarre pas.
 *
 * Seule la DÉCLARATION est nécessaire (pour que l'héritage se résolve). Tout le reste lève :
 * rien dans le lot C ne touche aux questionnaires, et une doublure silencieuse ferait passer
 * au vert un test qui croirait les exercer.
 */
class QuestionnaireHelper
{
    /** @var mixed Lu par `SocializerQuestionnaireHelper::__construct`. */
    public $questionnaire;

    /** @var mixed Écrit par `SocializerQuestionnaireHelper::__construct`. */
    public $collection;

    public function __construct(
        $questionnaire_id = null,
        $formable = null,
        $answer_id = null,
        $standalone = false,
        $custom_collection = false,
    ) {
        throw new \LogicException(
            'QuestionnaireHelper est une doublure inerte du harnais. Le test qui vous amène '
            .'ici dépend réellement du module questionnaires : implémentez ce comportement '
            .'dans tests/Stubs/Formdesigner/, ou montez la vraie dépendance.'
        );
    }

    public function BuildQuestionnaire()
    {
        throw new \LogicException('QuestionnaireHelper::BuildQuestionnaire() — doublure inerte.');
    }
}
