<?php

namespace Dauvray\Socializer\app\Helpers\ControllerTraits;

trait SocializerHelperTrait
{
    public function socializerFields()
    {
        // Tab params
        $this->crud->addField([
            'name' => 'settings_separator',
            'type' => 'custom_html',
            'value' => '<h4 class="mt-3">Socializer</h4>',
            'tab' => trans('estarter::common.settings')
        ]);

        if (\Config('estarter.allow_comments')) {
            $this->crud->addField([
                'name' => 'enable_comments',
                'label' => 'Autorise les commentaires',
                'fake' => true,
                'type' => 'checkbox',
                'default' => true,
                'tab' => trans('estarter::common.settings')
            ], 'update');
        }

        if (\Config('estarter.allow_rating')) {
            $this->crud->addField([
                'name' => 'enable_rates',
                'label' => 'Autorise les votes',
                'fake' => true,
                'type' => 'checkbox',
                'default' => true,
                'tab' => trans('estarter::common.settings')
            ]);
        }

        if (\Config('estarter.allow_likes')) {
            $this->crud->addField([
                'name' => 'enable_likes',
                'label' => 'Autorise les likes',
                'fake' => true,
                'type' => 'checkbox',
                'default' => true,
                'tab' => trans('estarter::common.settings')
            ]);
        }

        if (\Config('estarter.allow_sharing')) {
            $this->crud->addField([    // CHECKBOX
                'name' => 'enable_sharing',
                'label' => 'Autorise le partage sur les réseaux sociaux',
                'fake' => true,
                'type' => 'checkbox',
                'default' => true,
                'tab' => trans('estarter::common.settings')
            ]);
        }

        if (\Config('estarter.allow_facebook_sharing')) {
            $this->crud->addField([    // CHECKBOX
                'name' => 'enable_facebook_sharing',
                'label' => 'Autorise le partage sur facebook',
                'fake' => true,
                'type' => 'checkbox',
                'default' => true,
                'tab' => trans('estarter::common.settings')
            ]);
        }

        if (\Config('estarter.allow_twitter_sharing')) {
            $this->crud->addField([    // CHECKBOX
                'name' => 'enable_twitter_sharing',
                'label' => 'Autorise le partage sur twitter',
                'fake' => true,
                'type' => 'checkbox',
                'default' => true,
                'tab' => trans('estarter::common.settings')
            ]);
        }

        if (\Config('estarter.allow_pinterest_sharing')) {
            $this->crud->addField([    // CHECKBOX
                'name' => 'enable_pinterest_sharing',
                'label' => 'Autorise le partage sur pinterest',
                'fake' => true,
                'type' => 'checkbox',
                'default' => true,
                'tab' => trans('estarter::common.settings')
            ]);
        }

        if (\Config('estarter.allow_linkedin_sharing')) {
            $this->crud->addField([    // CHECKBOX
                'name' => 'enable_linkedin_sharing',
                'label' => 'Autorise le partage sur linkedin',
                'fake' => true,
                'type' => 'checkbox',
                'default' => true,
                'tab' => trans('estarter::common.settings')
            ]);
        }

        if (\Config('estarter.allow_tumblr_sharing')) {
            $this->crud->addField([    // CHECKBOX
                'name' => 'enable_tumblr_sharing',
                'label' => 'Autorise le partage sur tumblr',
                'fake' => true,
                'type' => 'checkbox',
                'default' => true,
                'tab' => trans('estarter::common.settings')
            ]);
        }

        if (\Config('estarter.allow_email_sharing')) {
            $this->crud->addField([    // CHECKBOX
                'name' => 'enable_email_sharing',
                'label' => 'Autorise le partage par email',
                'fake' => true,
                'type' => 'checkbox',
                'default' => true,
                'tab' => trans('estarter::common.settings')
            ]);
        }

    }

}