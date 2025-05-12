/////////////// LARAVEL Socializer ///////////////
///
///
<!-- // Home > Networks
Breadcrumbs::for('networks', function ($breadcrumbs) {
    $breadcrumbs->parent('home');
    $breadcrumbs->push('Networks', route('networks'));
});

// Home > Networks > room
Breadcrumbs::for('networks.show', function ($breadcrumbs, $network) {
$breadcrumbs->parent('networks');
$breadcrumbs->push($network->name, route('networks.show', $network->id ));
});

// Home > users
Breadcrumbs::for('networks.users', function ($breadcrumbs) {
$breadcrumbs->parent('home');
$breadcrumbs->push('Communauté', null);
});

// Home > friends
Breadcrumbs::for('user.friends', function ($breadcrumbs) {
$breadcrumbs->parent('home');
$breadcrumbs->push("Mes relations", null);
});

//Home > profile
Breadcrumbs::for('user.profile', function ($breadcrumbs) {
$breadcrumbs->parent('home');
$breadcrumbs->push("Mon compte", null);
}); -->

//Home > me
Breadcrumbs::for('wall.index', function ($breadcrumbs, $user) {
    $breadcrumbs->parent('home');
    $breadcrumbs->push($user->name, route('wall.index', $user->slug));
});

<!-- // Home > me > feed
Breadcrumbs::for('user.feed', function ($breadcrumbs, $user) {
$breadcrumbs->parent('user.wall', $user);
$breadcrumbs->push(__('socializer::network.feed'), null);
}); -->


