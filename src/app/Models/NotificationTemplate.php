<?php

namespace Dauvray\Socializer\app\Models;

use Dauvray\Estarter\app\Models\General\NotificationTemplate as EstarterNotificationTemplate;

class NotificationTemplate extends EstarterNotificationTemplate
{
    public function __construct(array $attributes = [])
    {
        $this->fillable[] = 'category_id';
        $this->fillable[] = 'section_id';

        parent::__construct($attributes);
    }

}