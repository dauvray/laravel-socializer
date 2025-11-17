<?php

namespace Dauvray\Socializer\app\Console\Commands;

use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Role;
use Illuminate\Support\Facades\Hash;
use Dauvray\Estarter\app\Console\Commands\EstarterPrepare;


class SocializerInstall extends EstarterPrepare
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'socializer:build {--timeout=300} : How many seconds to allow each process to run.';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Installation Socializer';

    /**
     * Create a new command instance.
     *
     * @return void
     */
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Execute the console command.
     *
     * @return mixed
     */
    public function handle()
    {
        $this->info('
          _________             .__       .__  .__
         /   _____/ ____   ____ |__|____  |  | |__|_______ ___________
         \_____  \ /  _ \_/ ___\|  \__  \ |  | |  \___   // __ \_  __ \
         /        (  <_> )  \___|  |/ __ \|  |_|  |/    /\  ___/|  | \/
        /_______  /\____/ \___  >__(____  /____/__/_____ \\___  >__|
                \/  Install   \/        \/              \/    \/
        ');

        // publish package
        $this->executeArtisanProcess('vendor:publish', [
            '--provider' => 'Dauvray\Socializer\ServiceProvider'
        ]);

        $this->executeProcess(['composer', 'dump-autoload']);

        // update database
        $this->executeArtisanProcess('migrate');
        $this->executeArtisanProcess('db:seed', [
            '--class' => 'Dauvray\Socializer\database\seeders\DatabaseSeeder'
        ]);
        $this->replaceInfile(
            base_path('database/seeders/DatabaseSeeder.php'),
            "// -- DO NOT DELETE THIS LINE : new seeders can automatically be inserted here",
            '$this->call(\Dauvray\Socializer\database\seeders\DatabaseSeeder::class);'."\n"
            ."// -- DO NOT DELETE THIS LINE : new seeders can automatically be inserted here\n"
        );

        $this->executeProcess(['cp', '-a',
            base_path('vendor/dauvray/laravel-socializer/src/resources/views/vendor/.'),
            base_path('resources/views/vendor/.')
        ]);

        // set Echo config
        $this->executeProcess(['cp', '-a',
            base_path('vendor/dauvray/laravel-socializer/src/resources/js/echo.js'),
            base_path('resources/js/echo.js')
        ]);


        // update estarter config

        // todo prevoir des warnings si les lignes n'existent pas
        $this->replaceInfile(
            base_path('config/estarter.php'),
            '$prefix_back.\'\General\UserCrudController\'',
            "'Dauvray\Socializer\app\Http\Controllers\Admin\UserCrudController'"
        );

        $this->replaceInfile(
            base_path('config/estarter.php'),
            "Dauvray\Estarter\app\Services\OnlineUsersService",
            "Dauvray\Socializer\app\Services\OnlineUsersService"
        );

        $this->replaceInfile(
            base_path('config/estarter.php'),
            '$prefix_back.\'\General\NotificationTemplateCrudController\'',
            "'\Dauvray\Socializer\app\Http\Controllers\Admin\NotificationTemplateCrudController'"
        );

        $this->replaceInfile(
            base_path('config/estarter.php'),
            'Dauvray\Estarter\app\Models\General\NotificationTemplate::class',
            "Dauvray\Socializer\app\Models\NotificationTemplate::class"
        );

        // todo a filtrer
        $this->executeProcess(['cp', '-a',
            base_path('vendor/dauvray/laravel-socializer/src/public/.'),
            base_path('public/.')
        ]);

        $this->executeProcess(['cp', '-a',
            base_path('vendor/dauvray/laravel-socializer/src/resources/js/socializer_custom_elements/'),
            base_path('resources/js/')
        ]);

        $file=file_get_contents('.env');
        $file.="DB_GRAPH_SPACE=network\n";
        file_put_contents('.env', $file);

        $fp1 = fopen(base_path('routes/breadcrumbs.php'), 'a+');
        $file2 = file_get_contents(base_path('vendor/dauvray/laravel-socializer/src/routes/breadcrumbs.php'));
        fwrite($fp1, $file2);

        $this->executeProcess(['npm', 'install', '--save', 'peerjs']);
        $this->executeProcess(['npm', 'install', '--save-dev', '@vitejs/plugin-react@latest']);
        $this->executeProcess(['npm', 'install', '--save', '@excalidraw/excalidraw']);
        $this->executeProcess(['npm', 'install', '--save', 'react@18']);
        $this->executeProcess(['npm', 'install', '--save', 'react-dom@18']);
        $this->executeProcess(['npm', 'install', '--save', '@floating-ui/dom']);

        // add vuejs components
        $this->replaceInfile(
            base_path('resources/js/vue.js'),
            "// -- DO NOT DELETE THIS LINE : new components can automatically be inserted here",
            "// [Socializer]\n
            //axios.defaults.headers.common['X-Socket-Id'] = Echo.socketId()\n
            import CommentWidget from '~socializer/components/Comment/Comments.vue'\n
            estarterApp.component('socializer-comments', CommentWidget)\n
            // -- DO NOT DELETE THIS LINE : new components can automatically be inserted here\n"
        );

        // overwrite estarter server widget
        $this->replaceInfile(
            base_path('resources/js/vue.js'),
            "~estarter/components/widgets/System/Server.vue",
            "~socializer/components/System/Server.vue"
        );

        // add alias
        $this->replaceInfile(
            base_path('vite.config.js'),
            "// -- DO NOT DELETE THIS LINE : new alias can automatically be inserted here",
            '"~socializer":  path.resolve(__dirname, "vendor/dauvray/laravel-socializer/src/resources/js/socializer"),'."\n"
            ."// -- DO NOT DELETE THIS LINE : new alias can automatically be inserted here\n"
        );

        // create user slug
        $users = config('estarter.models.user')::all();
        foreach($users as $user) {
            $user->slug = Str::of($user->name)->slug('-')->value;
            $user->save();
        }

        // formdesigner elements
        $this->replaceInfile(
            resource_path('js/formdesigner_custom_elements/fieldCreators/index.js'),
            "// -- DO NOT DELETE THIS LINE : new FieldCreators can automatically be inserted here",
            "import customSocializerFieldCreators from '~socializer/formdesigner_custom_elements/fieldCreators'"."\n"
            ."// -- DO NOT DELETE THIS LINE : new FieldCreators can automatically be inserted here\n"
        );
        $this->replaceInfile(
            resource_path('js/formdesigner_custom_elements/fieldCreators/index.js'),
            "// -- DO NOT DELETE THIS LINE : new export can automatically be inserted here",
            "...customSocializerFieldCreators,"."\n"
            ."// -- DO NOT DELETE THIS LINE : new export can automatically be inserted here\n"
        );
        $this->replaceInfile(
            resource_path('js/formdesigner_custom_elements/customFieldCreators.js'),
            "// -- DO NOT DELETE THIS LINE : new import can automatically be inserted here",
            "import { customSocializerFieldTypes, customSocializerIgnoredFields } from '~socializer/formdesigner_custom_elements/customFieldCreators.js'"."\n"
            ."// -- DO NOT DELETE THIS LINE : new import can automatically be inserted here\n"
        );

        $this->replaceInfile(
            resource_path('js/formdesigner_custom_elements/customFieldCreators.js'),
            "// -- DO NOT DELETE THIS LINE : new customFieldTypes can automatically be inserted here",
            "...customSocializerFieldTypes,"."\n"
            ."// -- DO NOT DELETE THIS LINE : new customFieldTypes can automatically be inserted here\n"
        );

        $this->replaceInfile(
            resource_path('js/formdesigner_custom_elements/customFieldCreators.js'),
            "// -- DO NOT DELETE THIS LINE : new customIgnoredFields can automatically be inserted here",
            "[...customSocializerIgnoredFields],"."\n"
            ."// -- DO NOT DELETE THIS LINE : new customIgnoredFields can automatically be inserted here\n"
        );

        // cards notifications
         $this->replaceInfile(
            resource_path('js/estarter_custom_elements/notifications/index.js'),
            "// -- DO NOT DELETE THIS LINE : new cardsNotifications can automatically be inserted here",
            "import socializerCardsNotification from '~socializer/components/widgets/Notifications'"."\n"
            ."// -- DO NOT DELETE THIS LINE : new cardsNotifications can automatically be inserted here\n"
        );

        $this->replaceInfile(
            resource_path('js/estarter_custom_elements/notifications/index.js'),
            "// -- DO NOT DELETE THIS LINE : new export can automatically be inserted here",
            "...socializerCardsNotification,"."\n"
            ."// -- DO NOT DELETE THIS LINE : new export can automatically be inserted here\n"
        );


        /**
         * CREATE FORMS
         */

        // post from
        $classic_post =             [
            'created_at' => '2019-01-01 00:00:00',
            'updated_at' => '2019-01-01 00:00:00',
            'code' => null,
            'name' => 'Post classic',
            'slug' => null,
            'form_id' => null,
            'active' => '1',
            'publish_date' => null,
            'unpublish_date' => null,
            'extras' => '{"model":"App\\Models\\User","collection":"answer_mongo","permission":null}',
            'settings' => '{"schema":{"fields":[],"groups":[{"legend":"Publication","fields":[{"label":"Post","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"POST","group":0,"subGroup":null,"family":null,"required":false,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":[],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"textareaComponent","maxCharsLimit":false,"maxChars":524000,"rows":4,"textWysiwyg":false,"speechRecognisable":true,"idx":0}],"settings":{"crossroads":[],"behaviour":"step","scripted":false,"script":null,"validationScripted":false,"validationScript":null,"cancelBtnLabel":"Annuler","validBtnLabel":"Enregistrer","customBtnActive":false,"customBtns":[]}}],"modals":[]},"config":{"saveAtEnd":false,"isPaginated":false,"isPaginatedLinks":true,"isPaginatedFooter":true,"isProgressBar":false,"canGoBack":false,"canGoBackNumber":null,"autoLoadAnswer":true,"canSeeAnswer":false,"canAnswerTwice":false,"answerMultiple":false,"canResetFields":false,"canSeeHistory":false,"canGetOthersAnswers":false,"canInitializeOthersAnswers":false,"isAuthorized":true,"unAuthorizedType":null,"confirmationEmail":false,"confirmationLink":false,"subGroups":[],"isSubQuestionnaire":false,"subQuestionnaires":{"btnLabel":null,"addFree":false,"items":[]},"version":1,"isDirty":true,"lockVersion":true,"commentsActivated":false,"randomized":false,"restrictedModeActivated":false,"reportAppearance":null,"reportAppearanceFolder":null,"reportable":false,"reportableOnline":false,"postTargetURL":null,"getTargetURL":null,"redirectTargetURL":null,"json":[],"filters":[],"filterColumnsResult":[],"filterResultType":"state","filterResultPath":null,"filterResultTarget":"_self","filterResultFormat":"list","adminPanelColumns":[],"adminPanelTitle":"Panneau d\'administration","adminPanelBtnActions":[],"scriptedBeforeSend":false,"scriptBeforeSendTxt":null,"scriptedAtEnd":false,"scriptAtEndTxt":null,"scriptedBeforeEnd":false,"scriptBeforeEndTxt":null,"scriptedModalValidation":false,"scriptModalValidationTxt":null,"scriptedModalReset":false,"scriptModalResetTxt":null,"displayGroupLegend":true,"deportValidation":false,"saveAlert":true,"validationButtonLabel":"Envoyer","enableAutoFill":false,"crossroad":false,"options":{"validateAfterLoad":true,"validateAfterChanged":true,"validateAsync":false,"fieldIdPrefix":null,"validationErrorClass":"is-invalid","validationSuccessClass":"is-valid"},"ignoredFieldTypes":["WordingComponent","SpacerComponent"]}}',
            'lft' => '1',
            'rgt' => '2',
            'depth' => '0',
            'parent_id' => null,
            'group_id' => null,
            'network_id' => null,
            'position' => null,
            'deleted_at' => null
        ];

        $id = DB::table('questionnaires')->insert($classic_post);

        $this->putInFile(base_path('.env'), "
            SOCIALIZER_POST_FORM_ID=$id\n
            VITE_SOCIALIZER_POST_FORM_ID=\"${SOCIALIZER_POST_FORM_ID}\"\n
        ");

        // create room form
        $create_server_room_form = [
            'created_at' => '2019-01-01 00:00:00',
            'updated_at' => '2019-01-01 00:00:00',
            'code' => null,
            'name' => 'Création de salon',
            'slug' => null,
            'form_id' => null,
            'active' => '1',
            'publish_date' => null,
            'unpublish_date' => null,
            'extras' => '{"model":"App\\Models\\User","collection":"answer_mongo","permission":null}',
            'settings' => '{"schema":{"fields":[],"groups":[{"legend":"Annonce","fields":[{"label":"Titre de l\'annonce","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"TITRE","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required","required","required","required","required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"inputComponent","inputType":"text","speechRecognisable":true,"idx":0},{"label":"Cat\u00e9gorie","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"CATEGORIE","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":"col-md-6","styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required","required","required","required","required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"SelectizeComponent","multiple":false,"selectizeAddElement":false,"selectizeAddFormat":null,"synchronizedValues":false,"synchronizedModel":null,"values":[{"name":"CATEGORIE-0-0","type":"text","label":"Emploi","value":"emploi"},{"name":"CATEGORIE-1-1","type":"text","label":"V\u00e9hicules","value":"vehicules"},{"name":"CATEGORIE-2-2","type":"text","label":"Immobilier","value":"immobilier"},{"name":"CATEGORIE-3-3","type":"text","label":"Locations de vacances","value":"location_vacances"},{"name":"CATEGORIE-4-4","type":"text","label":"Electronique","value":"electronique"},{"name":"CATEGORIE-5-5","type":"text","label":"Maison et jardin","value":"maison_jardin"},{"name":"CATEGORIE-6-6","type":"text","label":"Famille","value":"famille"},{"name":"CATEGORIE-7-7","type":"text","label":"Mode","value":"mode"},{"name":"CATEGORIE-8-8","type":"text","label":"Loisirs","value":"loisirs"},{"name":"CATEGORIE-9-9","type":"text","label":"Animaux","value":"animaux"},{"name":"CATEGORIE-10-10","type":"text","label":"Mat\u00e9riel professionnel","value":"materiel_professionnel"},{"name":"CATEGORIE-11-11","type":"text","label":"Services","value":"services"},{"name":"CATEGORIE-12-12","type":"text","label":"Divers","value":"divers"}],"speechRecognisable":false,"idx":1},{"label":"Sous cat\u00e9gorie","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"SOUS_CATEGORIE","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":"col-md-6","styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required","required","required","required","required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"SelectizeComponent","multiple":false,"selectizeAddElement":false,"selectizeAddFormat":null,"synchronizedValues":true,"synchronizedModel":"CATEGORIE","values":[{"name":"SOUS_CATEGORIE-0-0","type":"text","label":"Offre d\'emploi","value":"offre_emploi","synchronizedValue":"emploi"},{"name":"SOUS_CATEGORIE-1-0","type":"text","label":"Voitures","value":"voiture","synchronizedValue":"vehicules"},{"name":"SOUS_CATEGORIE-2-1","type":"text","label":"Motos","value":"moto","synchronizedValue":"vehicules"},{"name":"SOUS_CATEGORIE-3-2","type":"text","label":"Caravaning","value":"caravaning","synchronizedValue":"vehicules"},{"name":"SOUS_CATEGORIE-4-3","type":"text","label":"Utilitaires","value":"utilitaires","synchronizedValue":"vehicules"},{"name":"SOUS_CATEGORIE-5-4","type":"text","label":"Nautisme","value":"nautisme","synchronizedValue":"vehicules"},{"name":"SOUS_CATEGORIE-6-5","type":"text","label":"Equipement auto","value":"equipement_auto","synchronizedValue":"vehicules"},{"name":"SOUS_CATEGORIE-7-6","type":"text","label":"Equipement moto","value":"equipement_moto","synchronizedValue":"vehicules"},{"name":"SOUS_CATEGORIE-8-7","type":"text","label":"Equipement caravaning","value":"equipement_caravaning","synchronizedValue":"vehicules"},{"name":"SOUS_CATEGORIE-9-8","type":"text","label":"Equipement nautisme","value":"equipement_nautisme","synchronizedValue":"vehicules"},{"name":"SOUS_CATEGORIE-10-0","type":"text","label":"Ventes immobili\u00e8res","value":"ventes_immobilieres","synchronizedValue":"immobilier"},{"name":"SOUS_CATEGORIE-11-1","type":"text","label":"Locations","value":"locations","synchronizedValue":"immobilier"},{"name":"SOUS_CATEGORIE-12-2","type":"text","label":"Colocations","value":"colocations","synchronizedValue":"immobilier"},{"name":"SOUS_CATEGORIE-13-3","type":"text","label":"Locations saisonni\u00e8res","value":"locations_saisonnieres","synchronizedValue":"location_vacances"},{"name":"SOUS_CATEGORIE-14-4","type":"text","label":"Ordinateurs","value":"ordinateurs","synchronizedValue":"electronique"},{"name":"SOUS_CATEGORIE-15-5","type":"text","label":"Accesoires informatique","value":"accessoires_informatique","synchronizedValue":"electronique"},{"name":"SOUS_CATEGORIE-16-6","type":"text","label":"Tablettes & liseuses","value":"tablettes_liseuses","synchronizedValue":"electronique"},{"name":"SOUS_CATEGORIE-17-7","type":"text","label":"Photo, audio & vid\u00e9o","value":"photo_audio_video","synchronizedValue":"electronique"},{"name":"SOUS_CATEGORIE-18-8","type":"text","label":"T\u00e9l\u00e9phones & Objets connect\u00e9s","value":"telephone_objets_connectes","synchronizedValue":"electronique"},{"name":"SOUS_CATEGORIE-19-9","type":"text","label":"Accessoires t\u00e9l\u00e9phones & Objets connect\u00e9s","value":"accessoires_telephone_objets_connectes","synchronizedValue":"electronique"},{"name":"SOUS_CATEGORIE-20-10","type":"text","label":"Consoles","value":"consoles","synchronizedValue":"electronique"},{"name":"SOUS_CATEGORIE-21-11","type":"text","label":"Jeux vid\u00e9os","value":"jeux_videos","synchronizedValue":"electronique"}],"speechRecognisable":false,"idx":2},{"label":"Photos","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"PHOTOS","group":0,"subGroup":null,"family":null,"required":false,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required","required","required","required","array"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"UploaderComponent","uploaderInline":false,"uploaderInlineWidth":750,"uploaderInlineHeight":550,"uploaderFileSizeMax":100000,"uploaderFileSizeMin":0,"uploaderSource":"disk","uploaderAllowedFileTypes":["ai","bmp","gif","ico","jpeg","jpg","png","ps","psd","svg","tif","tiff"],"speechRecognisable":false,"idx":3},{"label":"Etat","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"ETAT","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required","required","required","required","required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"RadiosCssButtons","values":[{"name":"ETAT-0-0","type":"text","label":"Etat neuf","value":"neuf"},{"name":"ETAT-1-1","type":"text","label":"Tr\u00e8s bon \u00e9tat","value":"tres_bon_etat"},{"name":"ETAT-2-2","type":"text","label":"Bon \u00e9tat","value":"bon_etat"},{"name":"ETAT-3-3","type":"text","label":"Etat satisfaisant","value":"etat_statisfaisant"},{"name":"ETAT-4-4","type":"text","label":"Pour pi\u00e8ces","value":"pour_pieces"}],"direction":"row","speechRecognisable":false,"idx":4},{"label":"Description de l\'annonce","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"DESCRIPTION","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required","required","required","required","required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"textareaComponent","maxCharsLimit":true,"maxChars":4000,"rows":4,"textWysiwyg":false,"speechRecognisable":true,"textEmoji":false,"idx":5},{"label":"Je fais un don","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"DON","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":"col-md-4","styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required","required","required","required","required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"RadiosCssButtons","values":[{"name":"DON-0-0","type":"text","label":"Oui","value":"oui"},{"name":"DON-1-1","type":"text","label":"Non","value":"non"}],"direction":"row","speechRecognisable":false,"idx":6},{"label":"Prix de vente","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"PRIX","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":true,"relatedModel":"DON","relatedAnswers":["non"],"relatedConstraint":"and","relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":"col-md-4","styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required","required","required","required","number","required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"NumberComponent","step":null,"unity":"\u20ac","sliderMultiple":false,"values":[],"speechRecognisable":false,"idx":7},{"label":"O\u00f9 se situe le bien","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"LOCALISATION","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required","required","required","required","required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"geocoderComponent","speechRecognisable":false,"idx":8},{"label":"test","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"1032566810679","group":0,"subGroup":null,"family":null,"required":false,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["array"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"UploaderComponent","uploaderInline":false,"uploaderInlineWidth":750,"uploaderInlineHeight":550,"uploaderFileSizeMax":100000,"uploaderFileSizeMin":0,"uploaderSource":"disk","uploaderAllowedFileTypes":[],"speechRecognisable":false,"idx":9}],"settings":{"crossroads":[],"behaviour":"step","scripted":false,"script":null,"validationScripted":false,"validationScript":null,"cancelBtnLabel":"Annuler","validBtnLabel":"Enregistrer","customBtnActive":false,"customBtns":[]}}],"modals":[]},"config":{"saveAtEnd":false,"isPaginated":false,"isPaginatedLinks":true,"isPaginatedFooter":true,"isProgressBar":false,"canGoBack":false,"canGoBackNumber":null,"autoLoadAnswer":false,"canSeeAnswer":true,"canAnswerTwice":true,"answerMultiple":false,"canResetFields":false,"canSeeHistory":false,"canGetOthersAnswers":false,"canInitializeOthersAnswers":false,"isAuthorized":true,"unAuthorizedType":null,"confirmationEmail":false,"confirmationLink":false,"subGroups":[],"isSubQuestionnaire":false,"subQuestionnaires":{"btnLabel":null,"addFree":false,"items":[]},"version":1,"isDirty":true,"lockVersion":true,"commentsActivated":false,"randomized":false,"shared":false,"restrictedModeActivated":false,"reportAppearance":null,"reportAppearanceFolder":null,"reportable":false,"reportableOnline":true,"postTargetURL":null,"getTargetURL":null,"redirectTargetURL":null,"json":[],"jumbotron":{"title":"<i class=\"las la-check text-success\"> <\/i> Merci pour votre participation.","content":"<p> Votre r\u00e9ponse a bien \u00e9t\u00e9 enregistr\u00e9e dans notre base de donn\u00e9es.<\/p> \n<button type=\"button\" class=\"btn btn-primary\"> Se d\u00e9connecter<\/button> "},"filters":[{"id":"model.CATEGORIE","title":"Cat\u00e9gorie","model":"CATEGORIE","type":"SelectizeComponent","settings":{"label":null,"listType":"checkbox"}}],"filterColumnsResult":[],"filterResultType":"state","filterResultPath":null,"filterResultTarget":"_self","filterResultFormat":"list","filterResultTemplate":{"template":"SimpleCard","width":"col-12","elements":[{"name":"title","label":"Titre","source":"model","value":"TITRE"},{"name":"subTitle","label":"Sous-titre","source":"model","value":"CATEGORIE"},{"name":"content","label":"R\u00e9sum\u00e9","source":"model","value":"PRIX"},{"name":"link","label":"Label du lien","source":"input","value":"Voir"}]},"filterUserAnswersOnly":true,"filterResultGlobalLimited":false,"filterResultGlobalLimitations":[],"filterResultUserLimited":false,"filterResultUserLimitations":[],"adminPanelColumns":[{"id":"model.TITRE","title":"Titre de l\'annonce","model":"TITRE","type":"inputComponent","settings":{"label":null}},{"id":"model.CATEGORIE","title":"Cat\u00e9gorie","model":"CATEGORIE","type":"SelectizeComponent","settings":{"label":null}},{"id":"model.PRIX","title":"Prix de vente","model":"PRIX","type":"NumberComponent","settings":{"label":null}}],"adminPanelTitle":"Panneau d\'administration","adminPanelBtnActions":{"read":true,"create":true,"update":true,"delete":true,"print":true},"scriptedBeforeSend":false,"scriptBeforeSendTxt":null,"scriptedAtEnd":false,"scriptAtEndTxt":null,"scriptedBeforeEnd":false,"scriptBeforeEndTxt":null,"scriptedModalValidation":false,"scriptModalValidationTxt":null,"scriptedModalReset":false,"scriptModalResetTxt":null,"displayGroupLegend":true,"deportValidation":false,"saveAlert":true,"validationButtonLabel":"Envoyer","enableAutoFill":false,"crossroad":false,"options":{"validateAfterLoad":true,"validateAfterChanged":true,"validateAsync":false,"fieldIdPrefix":null,"validationErrorClass":"is-invalid","validationSuccessClass":"is-valid"},"ignoredFieldTypes":["WordingComponent","SpacerComponent"],"adminOnlyAuthorResults":true}}',
            'parent_id' => null,
            'group_id' => null,
            'network_id' => null,
            'position' => null,
            'deleted_at' => null
        ];

        $id = DB::table('questionnaires')->insert($create_server_room_form);

        $this->putInFile(base_path('.env'), "
            SOCIALIZER_CREATE_ROOM_FORM_ID=$id\n
            VITE_SOCIALIZER_CREATE_ROOM_FORM_ID=\"${SOCIALIZER_CREATE_ROOM_FORM_ID}\"\n
        ");

        // create server form
        $create_server_form = [
            'created_at' => '2019-01-01 00:00:00',
            'updated_at' => '2019-01-01 00:00:00',
            'code' => null,
            'name' => 'Création de serveur',
            'slug' => null,
            'form_id' => null,
            'active' => '1',
            'publish_date' => null,
            'unpublish_date' => null,
            'extras' => '{"model":"App\\Models\\User","collection":"answer_mongo","permission":null}',
            'settings' => '{"schema":{"fields":[],"groups":[{"legend":"Nouveau serveur","fields":[{"label":"Nom","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"SERVER_NAME","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"inputComponent","inputType":"text","speechRecognisable":true,"idx":0},{"label":"Serveur priv\u00e9","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"SERVER_PRIVACY","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"RadiosCssButtons","values":[{"name":"SERVER_PRIVACY-0-0","type":"text","label":"Oui","value":"oui"},{"name":"SERVER_PRIVACY-1-1","type":"text","label":"Non","value":"non"}],"direction":"row","speechRecognisable":false,"idx":1}],"settings":{"crossroads":[],"behaviour":"step","scripted":false,"script":null,"validationScripted":false,"validationScript":null,"cancelBtnLabel":"Annuler","validBtnLabel":"Enregistrer","customBtnActive":false,"customBtns":[]}}],"modals":[],"columns":[],"filters":[]},"config":{"saveAtEnd":false,"isPaginated":false,"isPaginatedLinks":true,"isPaginatedFooter":true,"isProgressBar":false,"canGoBack":false,"canGoBackNumber":null,"autoLoadAnswer":true,"canSeeAnswer":false,"canAnswerTwice":false,"answerMultiple":false,"canResetFields":false,"canSeeHistory":false,"canGetOthersAnswers":false,"canInitializeOthersAnswers":false,"isAuthorized":true,"unAuthorizedType":null,"confirmationEmail":false,"confirmationLink":false,"subGroups":[],"isSubQuestionnaire":false,"subQuestionnaires":{"btnLabel":null,"addFree":false,"items":[]},"version":1,"isDirty":true,"lockVersion":true,"commentsActivated":false,"randomized":false,"restrictedModeActivated":false,"reportAppearance":null,"reportAppearanceFolder":null,"reportable":false,"reportableOnline":false,"postTargetURL":null,"getTargetURL":null,"redirectTargetURL":null,"json":[],"filters":[],"filterColumnsResult":[],"filterResultType":"state","filterResultPath":null,"filterResultTarget":"_self","filterResultFormat":"list","filterResultGlobalLimited":false,"filterResultGlobalLimitations":[],"filterResultUserLimited":false,"filterResultUserLimitations":[],"adminPanelColumns":[],"adminPanelTitle":"Panneau d\'administration","adminPanelBtnActions":[],"scriptedBeforeSend":false,"scriptBeforeSendTxt":null,"scriptedAtEnd":false,"scriptAtEndTxt":null,"scriptedBeforeEnd":false,"scriptBeforeEndTxt":null,"scriptedModalValidation":false,"scriptModalValidationTxt":null,"scriptedModalReset":false,"scriptModalResetTxt":null,"displayGroupLegend":false,"deportValidation":false,"saveAlert":true,"validationButtonLabel":"Envoyer","enableAutoFill":false,"crossroad":false,"options":{"validateAfterLoad":true,"validateAfterChanged":true,"validateAsync":false,"fieldIdPrefix":null,"validationErrorClass":"is-invalid","validationSuccessClass":"is-valid"},"ignoredFieldTypes":["WordingComponent","SpacerComponent","WordingComponent","SpacerComponent"]}}',
            'lft' => '7',
            'rgt' => '8',
            'depth' => '0',
            'parent_id' => null,
            'group_id' => null,
            'network_id' => null,
            'position' => null,
            'deleted_at' => null
        ];

        $id = DB::table('questionnaires')->insert($create_server_form);
        $this->putInFile(base_path('.env'), "
            SOCIALIZER_CREATE_SERVER_FORM_ID=$id\n
            VITE_SOCIALIZER_CREATE_SERVER_FORM_ID=\"${SOCIALIZER_CREATE_SERVER_FORM_ID}\"\n
        ");

        // create access server request form
        $create_access_server_request_form = [
            // todo
        ];
        $id = DB::table('questionnaires')->insert($create_access_server_request_form);
        $this->putInFile(base_path('.env'), "
            SOCIALIZER_ACCESS_PRIVATE_SERVER_FORM_ID=$id\n
            VITE_SOCIALIZER_ACCESS_PRIVATE_SERVER_FORM_ID=\"${SOCIALIZER_ACCESS_PRIVATE_SERVER_FORM_ID}\"\n
        ");

        // create add room module form
        $create_room_module_form = [
            // todo
         ];
        $id = DB::table('questionnaires')->insert($create_room_module_form);
        $this->putInFile(base_path('.env'), "
            SOCIALIZER_ADD_ROOM_MODULE_ID=$id\n
            VITE_SOCIALIZER_ADD_ROOM_MODULE_ID=\"${SOCIALIZER_ADD_ROOM_MODULE_ID}\"\n
        ");

        // create ai app details form
        $create_ai_app_details_form = [
            // todo
         ];
        $id = DB::table('questionnaires')->insert($create_ai_app_details_form);
        $this->putInFile(base_path('.env'), "
            SOCIALIZER_APP_AI_DETAILS=$id\n
            VITE_SOCIALIZER_APP_AI_DETAILS_ID=\"${SOCIALIZER_APP_AI_DETAILS}\"\n
        ");

        // add scss in app
        $this->executeProcess(['cp', '-r',
            base_path('vendor/dauvray/laravel-socializer/src/resources/sass/socializer'),
            base_path('resources/sass/.')
        ]);

        $this->replaceInfile(
            base_path('resources/sass/app.scss'),
            "// -- DO NOT DELETE THIS LINE : new CSS can automatically be inserted here",
            "// socializer\n"
            ."@import '_socializer.scss';\n"
            ."// -- DO NOT DELETE THIS LINE : new CSS can automatically be inserted here\n"
        );


        // create bot role
        Role::create(['name' => 'Agent AI']);

        // create bot user
        $chatbot = config('estarter.models.user')::create([
            "name" => "ChatBot",
            "email_verified_at" => "2018-07-11 16:19:10",
            "email" => "chatbot@estarter.com",
            "password" => Hash::make('adminpass'),
            "extras" => [
                "private" => "1",
                "function" => ""
                ],
            "active" => "0",
            "is_bot" => "1",
        ]);
        $chatbot->assignRole('Agent AI');
        createUserAndNetwork($chatbot);
        $this->putInFile(base_path('.env'), "
            SOCIALIZER_CHATBOT_USER_ID=$chatbot->id\n
            VITE_SOCIALIZER_CHATBOT_USER_ID=\"${SOCIALIZER_CHATBOT_USER_ID}\"\n
        ");

        $this->executeArtisanProcess('migrate');

        // Clear caches
        $this->executeArtisanProcess('cache:clear');
        $this->executeArtisanProcess('config:clear');
        $this->executeArtisanProcess('route:clear');
        $this->executeArtisanProcess('view:clear');

        $this->info('Installation terminée.');
    }
}
