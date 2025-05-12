<?php

namespace Dauvray\Socializer\database\seeders;

use Illuminate\Database\Seeder;

use Dauvray\Estarter\app\Models\General\Menu;
use Dauvray\Estarter\app\Models\General\MenuItem;

class MenuTableSeeder extends Seeder
{

    /**
     * Run the database seeds.
     *
     * @return void
     */
    public function run()
    {
        $entries = [
            [
                "menu" => [
                    'name' => 'Menu Socializer',
                    'extras' => [
                        "position" => "row",
                        "permission" => null
                    ]
                ],
                "childs" => [
                    [
                        'name' => 'Conversations',
                        'type' => 'internal_link',
                        'active' => '1',
                        'extras' => [
                            "group" => null,
                            "class" => null,
                            "layout_class_container" => "container-fluid",
                            "icon" => null,
                            "permission" => null
                        ]
                    ],
                    [
                        'name' => 'Domaines',
                        'type' => 'internal_link',
                        'link' => '/app/servers',
                        'active' => '1',
                        'extras' => [
                            "group" => null,
                            "class" => null,
                            "layout_class_container" => null,
                            "icon" => 'las la-project-diagram',
                            "permission" => null
                        ]
                    ],
                    [
                        'name' => 'Membres',
                        'type' => 'internal_link',
                        'link' => '/app/users',
                        'active' => '1',
                        'extras' => [
                            "group" => null,
                            "class" => null,
                            "layout_class_container" => null,
                            "icon" => 'las la-users',
                            "permission" => null
                        ]
                    ],
                    [
                        'created_at' => '2019-01-01 00:00:00',
                        'updated_at' => '2019-01-01 00:00:00',
                        'name' => 'Fil',
                        'type' => 'internal_link',
                        'link' => '/app/feed',
                        'active' => '1',
                        'extras' => [
                            "group" => null,
                            "class" => null,
                            "layout_class_container" => null,
                            "icon" => 'las la-users',
                            "permission" => null
                        ]
                    ],
                    [
                        'created_at' => '2019-01-01 00:00:00',
                        'updated_at' => '2019-01-01 00:00:00',
                        'name' => 'Mur',
                        'type' => 'internal_link',
                        'link' => '/app/wall',
                        'active' => '1',
                        'extras' => [
                            "group" => null,
                            "class" => null,
                            "layout_class_container" => null,
                            "icon" => null,
                            "permission" => null
                        ]
                        ],
                        [
                            'created_at' => '2019-01-01 00:00:00',
                            'updated_at' => '2019-01-01 00:00:00',
                            'name' => 'Store',
                            'type' => 'internal_link',
                            'link' => '/app/store',
                            'active' => '1',
                            'extras' => [
                                "group" => null,
                                "class" => null,
                                "layout_class_container" => null,
                                "icon" => 'warehouse',
                                "permission" => null
                            ]
                        ]
                ]
            ]
        ];

        foreach ($entries as $entry) {
            $menu = new Menu();
            $menu->name = $entry["menu"]["name"];
            $menu->extras = $entry["menu"]["extras"];
            $menu->save();
            $this->createMenuItem($menu->id, $entry["childs"]);
        }
    }

    public function createMenuItem($menu_id, $childs, $parent_id = null)
    {
        foreach ($childs as $child) {
            $menu_item = new MenuItem();
            $menu_item->name = $child['name'];
            $menu_item->menu_id = $menu_id;
            $menu_item->parent_id = $parent_id;
            $menu_item->type = $child['type'];
            if (isset($child['type_id'])) {
                $menu_item->type_id = $child['type_id'];
            }
            $menu_item->link = $child['link'];
            $menu_item->active = $child['active'];
            $menu_item->extras = $child['extras'];
            $menu_item->save();

            if (isset($child["childs"])) {
                $this->createMenuItem($menu_id, $child["childs"], $menu_item->id);
            }
        }
    }

}