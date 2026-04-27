<?php

namespace Dauvray\Socializer\app\Models;

use Dauvray\Socializer\app\Helpers\ModelTraits\Socializable;
use Dauvray\Estarter\app\Models\General\Group as EstarterGroup;

class Group extends EstarterGroup
{
    use Socializable;
}