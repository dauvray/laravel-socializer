<?php

namespace Dauvray\Socializer\app\Http\Controllers\Admin;

use Dauvray\Estarter\app\Http\Controllers\Admin\General\UserCrudController as EstarterUserController;

class UserCrudController extends EstarterUserController
{
    public function setFields()
    {
        parent::setFields();

            $this->crud->addFields([
            [
                'name' => 'is_bot',
                'label' => 'Bot',
                'type' => 'toggle_switch',
                'tab' => trans('Agent IA'),
            ],
            [
                'name' => 'webhook_url',
                'label' => 'Webhook URL',
                'type' => 'text',
                'fake'     => true, 
                'store_in' => 'extras',
                'tab' => trans('Agent IA'),
            ],
            [   
                'name'  => 'prompt',
                'label' => 'Prompt',
                'type'  => 'textarea',
                'fake'     => true, 
                'store_in' => 'extras',
                 'tab' => trans('Agent IA'),
            ]

        ]);

    }

}