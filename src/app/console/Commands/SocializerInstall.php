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

        // create forms

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
            'settings' => '{"schema":{"fields":[],"groups":[{"legend":"Nouveau salon","fields":[{"label":"Nom du salon","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"name","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"editable":true,"type":"inputComponent","inputType":"text","speechRecognisable":true,"idx":0},{"label":"Type de salon","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"content_type","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":"col-md-4","styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"AvailableRoomTypeList","allowedValidators":[],"idx":1,"values":[{"label":"Page","value":"page","name":"content_type-1"},{"label":"Chat","value":"chat","name":"content_type-2"},{"label":"Questionnaire","value":"form","name":"content_type-3"},{"label":"Donn\u00e9es","value":"data","name":"content_type-4"},{"label":"Panneau d\'administration","value":"admin","name":"content_type-5"},{"label":"Tableau blanc","value":"whiteboard","name":"content_type-6"},{"label":"salon test","value":"test","name":"content_type-7"}]},{"label":"Questionnaire","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"questionnaire_id","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":true,"relatedModel":"content_type","relatedAnswers":["form","data","admin"],"relatedConstraint":"or","relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":"col-md-4","styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"ServerQuestionnaireList","allowedValidators":[],"values":[],"idx":2},{"label":"Sauvegarder le tableau","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"save_board","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":true,"relatedModel":"content_type","relatedAnswers":["whiteboard"],"relatedConstraint":"and","relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":"col-md-4","styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"RadiosCssButtons","values":[{"name":"save_board-0-0","type":"text","label":"Oui","value":1},{"name":"save_board-1-1","type":"text","label":"Non","value":0}],"direction":"row","speechRecognisable":false,"idx":3},{"label":null,"labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"__separateur__","group":0,"subGroup":null,"family":null,"required":false,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":[],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"SpacerComponent","spacerInvisible":false,"speechRecognisable":false,"idx":4},{"label":"Salon priv\u00e9","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"privacy","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":"col-md-6","styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"RadiosCssButtons","values":[{"name":"PRIVACY_SALON-1-1","type":"text","label":"Non","value":"0"},{"name":"PRIVACY_SALON-0-0","type":"text","label":"Oui","value":"1"},{"name":"privacy-2-0","type":"text","label":"Administrateur","value":2}],"direction":"row","speechRecognisable":false,"editable":true,"idx":5},{"label":"Restreindre les donn\u00e9es","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":"uniquement les donn\u00e9es de l\'auteur","hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"author_only","group":0,"subGroup":null,"family":null,"required":true,"disabled":false,"calculated":false,"calculations":[],"related":true,"relatedModel":"content_type","relatedAnswers":["admin"],"relatedConstraint":"and","relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":"col-md-6","styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["required"],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"RadiosCssButtons","values":[{"name":"AUTHOR_ONLY-0-0","type":"text","label":"Oui","value":1},{"name":"AUTHOR_ONLY-1-1","type":"text","label":"Non","value":0}],"direction":"row","speechRecognisable":false,"idx":6},{"label":"Cover","labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"image","group":0,"subGroup":null,"family":null,"required":false,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":["array"],"min":null,"max":null,"minLength":null,"maxLength":1,"maxLengthDisabled":false,"pattern":null,"type":"UploaderComponent","uploaderInline":false,"uploaderInlineWidth":750,"uploaderInlineHeight":550,"uploaderFileSizeMax":500000,"uploaderFileSizeMin":0,"uploaderSource":"disk","uploaderAllowedFileTypes":["jpeg","jpg","png","gif"],"speechRecognisable":false,"editable":true,"idx":7},{"label":null,"labelHtml":false,"labelClasses":null,"placeholder":null,"hint":null,"hintHtml":false,"help":null,"helpHtml":false,"informations":null,"model":"position","group":0,"subGroup":null,"family":null,"required":false,"disabled":false,"calculated":false,"calculations":[],"related":false,"relatedModel":null,"relatedAnswers":null,"relatedConstraint":null,"relatedComparison":null,"exportable":true,"readonly":false,"default":null,"defaultUrlStatus":false,"defaultUrl":null,"wrapperClasses":null,"styleClasses":null,"offsetClasses":null,"fieldClasses":null,"fieldStyleClasses":null,"fieldOffsetClasses":null,"visible":true,"reportable":true,"reportableOnline":true,"reportAppearance":null,"reportAppearanceSettings":null,"reportAppearanceFolder":null,"statisticsEnabled":false,"statisticsType":null,"otherAnswersEnabled":false,"slider":false,"sliderInput":true,"dashboardStatus":false,"dashboardGraph":null,"dashboardConfig":{"graphName":[]},"json":[],"loadValuesFromURL":false,"loadValuesFromURLTarget":null,"actionOnDisplay":false,"actionOnDisplayScript":null,"actionOnChange":false,"actionOnChangeScript":null,"attributes":{"wrapper":[],"input":[],"label":[]},"validator":[],"min":null,"max":null,"minLength":null,"maxLength":null,"maxLengthDisabled":false,"pattern":null,"type":"HiddenComponent","speechRecognisable":false,"idx":8}],"settings":{"crossroads":[],"behaviour":"step","scripted":false,"script":null,"validationScripted":false,"validationScript":null,"cancelBtnLabel":"Annuler","validBtnLabel":"Enregistrer","customBtnActive":false,"customBtns":[]}}],"modals":[]},"config":{"saveAtEnd":false,"isPaginated":false,"isPaginatedLinks":true,"isPaginatedFooter":true,"isProgressBar":false,"canGoBack":false,"canGoBackNumber":null,"autoLoadAnswer":true,"canSeeAnswer":true,"canAnswerTwice":true,"answerMultiple":false,"canResetFields":false,"canSeeHistory":false,"canGetOthersAnswers":false,"canInitializeOthersAnswers":false,"isAuthorized":true,"unAuthorizedType":null,"confirmationEmail":false,"confirmationLink":false,"subGroups":[],"isSubQuestionnaire":false,"subQuestionnaires":{"btnLabel":null,"addFree":false,"items":[]},"version":1,"isDirty":true,"lockVersion":true,"commentsActivated":false,"randomized":false,"restrictedModeActivated":false,"reportAppearance":null,"reportAppearanceFolder":null,"reportable":false,"reportableOnline":false,"postTargetURL":null,"getTargetURL":null,"redirectTargetURL":null,"json":[],"filters":[],"filterColumnsResult":[],"filterResultType":"state","filterResultPath":null,"filterResultTarget":"_self","filterResultFormat":"list","filterResultTemplate":{"template":null},"filterResultGlobalLimited":false,"filterResultGlobalLimitations":[],"filterResultUserLimited":false,"filterResultUserLimitations":[],"adminPanelColumns":[],"adminPanelTitle":"Panneau d\'administration","adminPanelBtnActions":[],"scriptedBeforeSend":false,"scriptBeforeSendTxt":null,"scriptedAtEnd":false,"scriptAtEndTxt":null,"scriptedBeforeEnd":false,"scriptBeforeEndTxt":null,"scriptedModalValidation":false,"scriptModalValidationTxt":null,"scriptedModalReset":false,"scriptModalResetTxt":null,"displayGroupLegend":false,"deportValidation":true,"saveAlert":false,"validationButtonLabel":"Envoyer","enableAutoFill":false,"crossroad":false,"options":{"validateAfterLoad":true,"validateAfterChanged":true,"validateAsync":false,"fieldIdPrefix":null,"validationErrorClass":"is-invalid","validationSuccessClass":"is-valid"},"ignoredFieldTypes":["WordingComponent","SpacerComponent"]}}',
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

        // create room form
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
         $this->executeProcess(['cp', '-a',
            base_path('vendor/dauvray/laravel-socializer/src/resources/sass/_socializer.scss'),
            base_path('resources/sass/_socializer.scss')
        ]);
        $this->executeProcess(['cp', '-a',
            base_path('vendor/dauvray/laravel-socializer/src/resources/sass/socializer'),
            base_path('resources/sass/socializer')
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
