<?php

namespace Dauvray\Socializer\app\Http\Controllers\Admin;

use Dauvray\Estarter\app\Http\Controllers\Admin\General\UserCrudController as EstarterUserController;

class UserCrudController extends EstarterUserController
{

    public function setColumns()
    {
        parent::setColumns();

            $this->crud->addColumns([
            [
                'name'  => 'extras.fremium',
                'type' => 'check',
                'label' => 'Fremium',
            ],
        ]);
    }

    public function setFields()
    {
        parent::setFields();

        // Agent IA fields
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

        // Fremium fields
        $this->crud->addFields([
            [
                'name' => 'fremium',
                'label' => 'Fremium',
                'type' => 'toggle_switch',
                'fake'     => true, 
                'store_in' => 'extras',
                'tab' => trans('Social plan'),
            ],
        ]);

    }

}