<?php

namespace Dauvray\Socializer\app\Http\Controllers\Admin;

use Dauvray\Estarter\app\Http\Controllers\Admin\General\NotificationTemplateCrudController as SocializerNotificationTemplateController;

class NotificationTemplateCrudController extends SocializerNotificationTemplateController
{
    public function setFields()
    {
        parent::setFields();

        $this->crud->addFields([
            [
                'label' => trans('eblogger::category.category'),
                'type' => 'select',
                'name' => 'category_id',
                'attribute' => 'name',
                'model'     => config('eblogger.models.category'), 
                'wrapper' => [
                    'class' => 'form-group col-md-6'
                ],
            ],
            [
                'label' => trans('eblogger::section.section'),
                'type' => 'select',
                'name' => 'section_id',
                'attribute' => 'name',
                'model'     => config('eblogger.models.section'), 
                'wrapper' => [
                    'class' => 'form-group col-md-6'
                ],
            ],
        ]);

        \CRUD::field('section_id')->after('slug');
        \CRUD::field('category_id')->after('section_id');
    }
}