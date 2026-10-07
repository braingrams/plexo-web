// The "Plexo Migrator" companion WordPress plugin, shipped as source strings so it's
// always bundled with the app (served as a zip by app/api/v1/wp-migration/plugin/route.ts).
//
// What it's for: a public crawl can copy everything a visitor sees, but some of a site's
// value lives only in WordPress's database — past form entries, records a custom plugin
// keeps (volunteer applications), donation history, drafts, redirect rules, the team who
// logs in. The plugin exposes exactly that, read-only, to Plexo — and only to the Plexo
// migration holding the one-time connection code the owner pasted in.
//
// Security model (keep it this way when editing):
//  - every endpoint is GET and read-only; nothing on the WordPress site is ever changed;
//  - every endpoint requires the connection code; only its SHA-256 hash is stored, and the
//    comparison is constant-time (hash_equals);
//  - database tables are readable only from an allow-list computed by the plugin itself
//    (non-core tables, minus known caches/queues), never from a name Plexo sends;
//  - columns that look like secrets (passwords, tokens, keys, card data) are never sent;
//  - user export is name + email + role only — never password hashes.

export const COMPANION_PLUGIN_VERSION = "1.0.0";

export const COMPANION_PLUGIN_PHP = String.raw`<?php
/**
 * Plugin Name:       Plexo Migrator
 * Plugin URI:        https://plexopages.com
 * Description:       Lets Plexo copy what WordPress doesn't publish — past form entries, donation history, drafts, redirects and your team list — when you move your site to Plexo. Read-only: it never changes anything on this site. Remove it once your move is finished.
 * Version:           ${COMPANION_PLUGIN_VERSION}
 * Requires at least: 5.6
 * Requires PHP:      7.2
 * Author:            Plexo
 * License:           GPLv2 or later
 * Text Domain:       plexo-migrator
 */

if (!defined('ABSPATH')) {
    exit;
}

define('PLEXO_MIGRATOR_VERSION', '${COMPANION_PLUGIN_VERSION}');
define('PLEXO_MIGRATOR_OPTION', 'plexo_migrator_key_hash');
define('PLEXO_MIGRATOR_MAX_LIMIT', 200);

/* ------------------------------------------------------------------ admin screen */

add_action('admin_menu', function () {
    add_management_page('Plexo Migrator', 'Plexo Migrator', 'manage_options', 'plexo-migrator', 'plexo_migrator_admin_page');
});

add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    array_unshift($links, '<a href="' . esc_url(admin_url('tools.php?page=plexo-migrator')) . '">Connect to Plexo</a>');
    return $links;
});

function plexo_migrator_admin_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $message = '';
    if (isset($_POST['plexo_migrator_action']) && check_admin_referer('plexo_migrator')) {
        if ($_POST['plexo_migrator_action'] === 'connect') {
            $code = isset($_POST['plexo_code']) ? trim(sanitize_text_field(wp_unslash($_POST['plexo_code']))) : '';
            if (strpos($code, 'plexo_') === 0 && strlen($code) >= 30) {
                update_option(PLEXO_MIGRATOR_OPTION, hash('sha256', $code), false);
                $message = 'Connected. Go back to Plexo and click “Check connection”.';
            } else {
                $message = 'That doesn’t look like a Plexo connection code — copy it again from your migration report in Plexo.';
            }
        } elseif ($_POST['plexo_migrator_action'] === 'disconnect') {
            delete_option(PLEXO_MIGRATOR_OPTION);
            $message = 'Disconnected. Plexo can no longer read anything from this site.';
        }
    }
    $connected = (bool) get_option(PLEXO_MIGRATOR_OPTION);
    echo '<div class="wrap"><h1>Plexo Migrator</h1>';
    if ($message) {
        echo '<div class="notice notice-info"><p>' . esc_html($message) . '</p></div>';
    }
    echo '<p style="max-width:640px">This lets Plexo copy the things WordPress doesn’t show publicly — past form entries, donation history, drafts, redirects and your team list. It is <strong>read-only</strong> and never changes this site. Remove the plugin once your move is finished.</p>';
    echo '<form method="post" style="max-width:640px">';
    wp_nonce_field('plexo_migrator');
    if ($connected) {
        echo '<p><span class="dashicons dashicons-yes-alt" style="color:#15803d"></span> <strong>Connected to Plexo.</strong></p>';
        echo '<input type="hidden" name="plexo_migrator_action" value="disconnect">';
        submit_button('Disconnect', 'secondary');
    } else {
        echo '<p><label for="plexo_code"><strong>Connection code</strong> (from your Plexo migration report)</label></p>';
        echo '<input type="text" id="plexo_code" name="plexo_code" class="regular-text code" style="width:100%" placeholder="plexo_…" autocomplete="off">';
        echo '<input type="hidden" name="plexo_migrator_action" value="connect">';
        submit_button('Connect to Plexo');
    }
    echo '</form></div>';
}

/* ------------------------------------------------------------------ auth */

function plexo_migrator_authorize(WP_REST_Request $request) {
    $hash = get_option(PLEXO_MIGRATOR_OPTION);
    if (!$hash) {
        return new WP_Error('plexo_not_connected', 'Plexo Migrator is installed but not connected yet.', array('status' => 401));
    }
    $key = $request->get_header('x-plexo-migrator-key');
    if (!$key) {
        // Some hosts strip custom headers; accept the code as a query parameter too.
        $key = $request->get_param('plexo_key');
    }
    if (!is_string($key) || $key === '' || !hash_equals($hash, hash('sha256', $key))) {
        return new WP_Error('plexo_wrong_code', 'Wrong connection code.', array('status' => 403));
    }
    return true;
}

/* ------------------------------------------------------------------ helpers */

function plexo_migrator_paging(WP_REST_Request $request) {
    $offset = max(0, intval($request->get_param('offset')));
    $limit = intval($request->get_param('limit'));
    if ($limit <= 0 || $limit > PLEXO_MIGRATOR_MAX_LIMIT) {
        $limit = PLEXO_MIGRATOR_MAX_LIMIT;
    }
    return array($offset, $limit);
}

function plexo_migrator_is_sensitive_column($name) {
    return (bool) preg_match('/(pass|pwd|token|secret|hash|salt|session|api_?key|auth|nonce|card|cvv|cvc|iban|ssn|private_key)/i', $name);
}

/** Non-core tables worth offering, with columns and row counts. Caches, queues and logs are left out. */
function plexo_migrator_plugin_tables() {
    global $wpdb;
    $core = array_map('strtolower', $wpdb->tables('all', true));
    $noise = '/(actionscheduler|_wc_|woocommerce_sessions|litespeed|wpmudev|yoast_|e_events|e_submissions_actions_log|redirection_404|redirection_logs|wfls|wfconfig|wfhits|wflogins|wf[a-z]+$|_cache|_log$|_logs$|sessions?$|frmt_|wpf_)/i';
    $like = $wpdb->esc_like($wpdb->prefix) . '%';
    $names = $wpdb->get_col($wpdb->prepare('SHOW TABLES LIKE %s', $like));
    $out = array();
    foreach ($names as $name) {
        if (in_array(strtolower($name), $core, true) || preg_match($noise, $name)) {
            continue;
        }
        $columns = $wpdb->get_col("SHOW COLUMNS FROM \`" . esc_sql($name) . "\`");
        $rows = intval($wpdb->get_var("SELECT COUNT(*) FROM \`" . esc_sql($name) . "\`"));
        $out[$name] = array(
            'name' => $name,
            'rows' => $rows,
            'columns' => array_values(array_filter($columns, function ($c) { return !plexo_migrator_is_sensitive_column($c); })),
        );
    }
    return $out;
}

function plexo_migrator_flatten($value) {
    if (is_array($value) || is_object($value)) {
        $parts = array();
        foreach ((array) $value as $v) {
            $flat = plexo_migrator_flatten($v);
            if ($flat !== '') {
                $parts[] = $flat;
            }
        }
        return implode(', ', $parts);
    }
    return trim(wp_strip_all_tags((string) $value));
}

/* ------------------------------------------------------------------ endpoints */

add_action('rest_api_init', function () {
    $ns = 'plexo-migrator/v1';
    $auth = 'plexo_migrator_authorize';

    register_rest_route($ns, '/status', array('methods' => 'GET', 'permission_callback' => $auth, 'callback' => function () {
        global $wpdb;
        $tables = array_values(plexo_migrator_plugin_tables());
        $forminator = array();
        if (class_exists('Forminator_API')) {
            $forms = Forminator_API::get_forms(null, 1, 100);
            foreach ((array) $forms as $form) {
                $forminator[] = array('id' => intval($form->id), 'title' => isset($form->settings['formName']) ? $form->settings['formName'] : ('Form ' . $form->id), 'entries' => intval(Forminator_API::count_entries($form->id)));
            }
        }
        $payform = null;
        $sub_table = $wpdb->prefix . 'wpf_submissions';
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $sub_table)) === $sub_table) {
            $payform = array('paid' => intval($wpdb->get_var("SELECT COUNT(*) FROM \`" . esc_sql($sub_table) . "\` WHERE payment_status = 'paid'")));
        }
        $drafts = new WP_Query(array('post_type' => array('post', 'page'), 'post_status' => array('draft', 'pending', 'private', 'future'), 'posts_per_page' => 1, 'fields' => 'ids'));
        return array(
            'plugin_version' => PLEXO_MIGRATOR_VERSION,
            'wp_version' => get_bloginfo('version'),
            'home_url' => home_url(),
            'tables' => $tables,
            'forminator_forms' => $forminator,
            'payform' => $payform,
            'drafts' => intval($drafts->found_posts),
            'redirects' => count(plexo_migrator_redirects()),
            'team' => count(plexo_migrator_team()),
        );
    }));

    register_rest_route($ns, '/table', array('methods' => 'GET', 'permission_callback' => $auth, 'callback' => function (WP_REST_Request $request) {
        global $wpdb;
        $tables = plexo_migrator_plugin_tables();
        $name = (string) $request->get_param('name');
        if (!isset($tables[$name])) {
            return new WP_Error('plexo_unknown_table', 'That table isn’t available.', array('status' => 404));
        }
        list($offset, $limit) = plexo_migrator_paging($request);
        $columns = $tables[$name]['columns'];
        if (!$columns) {
            return array('rows' => array());
        }
        $select = implode(', ', array_map(function ($c) { return '\`' . esc_sql($c) . '\`'; }, $columns));
        $rows = $wpdb->get_results($wpdb->prepare("SELECT {$select} FROM \`" . esc_sql($name) . "\` LIMIT %d OFFSET %d", $limit, $offset), ARRAY_A);
        return array('rows' => $rows ? $rows : array());
    }));

    register_rest_route($ns, '/forminator/entries', array('methods' => 'GET', 'permission_callback' => $auth, 'callback' => function (WP_REST_Request $request) {
        if (!class_exists('Forminator_API')) {
            return array('entries' => array());
        }
        $form_id = intval($request->get_param('form_id'));
        list($offset, $limit) = plexo_migrator_paging($request);
        $labels = array();
        foreach ((array) Forminator_API::get_form_fields($form_id) as $field) {
            $raw = is_object($field) && isset($field->raw) ? (array) $field->raw : array();
            $slug = isset($raw['element_id']) ? $raw['element_id'] : (isset($field->slug) ? $field->slug : '');
            if ($slug) {
                $labels[$slug] = isset($raw['field_label']) && $raw['field_label'] !== '' ? $raw['field_label'] : $slug;
            }
        }
        $entries = array_slice((array) Forminator_API::get_entries($form_id), $offset, $limit);
        $out = array();
        foreach ($entries as $entry) {
            $fields = array();
            foreach ((array) $entry->meta_data as $slug => $meta) {
                if (strpos($slug, '_') === 0 || plexo_migrator_is_sensitive_column($slug)) {
                    continue;
                }
                $value = plexo_migrator_flatten(is_array($meta) && isset($meta['value']) ? $meta['value'] : $meta);
                if ($value !== '') {
                    $label = isset($labels[$slug]) ? $labels[$slug] : $slug;
                    $fields[wp_strip_all_tags($label)] = $value;
                }
            }
            $out[] = array('id' => intval($entry->entry_id), 'date' => isset($entry->date_created_sql) ? $entry->date_created_sql : '', 'fields' => $fields);
        }
        return array('entries' => $out);
    }));

    register_rest_route($ns, '/payform/submissions', array('methods' => 'GET', 'permission_callback' => $auth, 'callback' => function (WP_REST_Request $request) {
        global $wpdb;
        $table = $wpdb->prefix . 'wpf_submissions';
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) !== $table) {
            return array('submissions' => array());
        }
        list($offset, $limit) = plexo_migrator_paging($request);
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, form_id, customer_name, customer_email, currency, payment_total, payment_method, payment_status, created_at FROM \`" . esc_sql($table) . "\` WHERE payment_status = 'paid' ORDER BY id ASC LIMIT %d OFFSET %d",
            $limit,
            $offset
        ), ARRAY_A);
        return array('submissions' => $rows ? $rows : array());
    }));

    register_rest_route($ns, '/redirects', array('methods' => 'GET', 'permission_callback' => $auth, 'callback' => function () {
        return array('redirects' => plexo_migrator_redirects());
    }));

    register_rest_route($ns, '/team', array('methods' => 'GET', 'permission_callback' => $auth, 'callback' => function () {
        return array('team' => plexo_migrator_team());
    }));

    register_rest_route($ns, '/drafts', array('methods' => 'GET', 'permission_callback' => $auth, 'callback' => function (WP_REST_Request $request) {
        list($offset, $limit) = plexo_migrator_paging($request);
        $posts = get_posts(array('post_type' => array('post', 'page'), 'post_status' => array('draft', 'pending', 'private', 'future'), 'numberposts' => $limit, 'offset' => $offset, 'orderby' => 'ID', 'order' => 'ASC'));
        $out = array();
        foreach ($posts as $post) {
            $out[] = array(
                'id' => $post->ID,
                'type' => $post->post_type,
                'status' => $post->post_status,
                'title' => get_the_title($post),
                'slug' => $post->post_name,
                'content' => function_exists('do_blocks') ? do_blocks($post->post_content) : $post->post_content,
                'excerpt' => $post->post_excerpt,
                'date_gmt' => $post->post_date_gmt,
            );
        }
        return array('drafts' => $out);
    }));

    register_rest_route($ns, '/comment-emails', array('methods' => 'GET', 'permission_callback' => $auth, 'callback' => function (WP_REST_Request $request) {
        list($offset, $limit) = plexo_migrator_paging($request);
        $comments = get_comments(array('status' => 'approve', 'number' => $limit, 'offset' => $offset, 'orderby' => 'comment_ID', 'order' => 'ASC'));
        $out = array();
        foreach ($comments as $c) {
            if ($c->comment_author_email) {
                $out[] = array('id' => intval($c->comment_ID), 'post_id' => intval($c->comment_post_ID), 'email' => $c->comment_author_email);
            }
        }
        return array('comments' => $out);
    }));
});

/** Redirect rules from the Redirection plugin and Yoast SEO Premium. */
function plexo_migrator_redirects() {
    global $wpdb;
    $out = array();
    $table = $wpdb->prefix . 'redirection_items';
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table) {
        $rows = $wpdb->get_results("SELECT url, action_data, action_code FROM \`" . esc_sql($table) . "\` WHERE status = 'enabled' AND regex = 0 AND action_type = 'url' LIMIT 5000", ARRAY_A);
        foreach ((array) $rows as $r) {
            $out[] = array('from' => $r['url'], 'to' => $r['action_data'], 'code' => intval($r['action_code']));
        }
    }
    $yoast = get_option('wpseo-premium-redirects-base');
    if (is_array($yoast)) {
        foreach ($yoast as $r) {
            if (isset($r['origin'], $r['url']) && (!isset($r['format']) || $r['format'] === 'plain')) {
                $out[] = array('from' => '/' . ltrim($r['origin'], '/'), 'to' => $r['url'], 'code' => isset($r['type']) ? intval($r['type']) : 301);
            }
        }
    }
    return $out;
}

/** People who log in to manage the site — name, email and role only. */
function plexo_migrator_team() {
    $out = array();
    foreach (get_users(array('role__not_in' => array('subscriber', 'customer'), 'number' => 500)) as $user) {
        $out[] = array('name' => $user->display_name, 'email' => $user->user_email, 'roles' => array_values((array) $user->roles));
    }
    return $out;
}
`
  // String.raw keeps the backslash in \` (needed to write a backtick inside the template) —
  // MySQL identifier quotes must reach PHP as plain backticks.
  .replace(/\\`/g, "`");

export const COMPANION_PLUGIN_README = `=== Plexo Migrator ===
Contributors: plexo
Requires at least: 5.6
Tested up to: 6.8
Requires PHP: 7.2
Stable tag: ${COMPANION_PLUGIN_VERSION}
License: GPLv2 or later

Copies what WordPress doesn't publish — past form entries, donation history, drafts, redirects and your team list — when you move your site to Plexo.

== Description ==

Plexo copies everything visitors can see on your site automatically. This plugin lets it also copy what only lives in your WordPress database:

* Past form entries (Forminator) and records other plugins keep, such as applications
* Donation history (Paymattic / WP Payment Form)
* Draft and private posts
* Redirect rules (Redirection, Yoast SEO Premium)
* Your team list, so you can invite them to Plexo

It is read-only and never changes your site. Only the Plexo migration holding your connection code can read anything, and you can disconnect at any time. Remove the plugin once your move is finished.

== Installation ==

1. In Plexo, open your migration report and click "Copy more with the Plexo Migrator plugin" to download it and get your connection code.
2. In WordPress, go to Plugins → Add New → Upload Plugin, and upload the zip.
3. Activate it, then go to Tools → Plexo Migrator and paste your connection code.
4. Back in Plexo, click "Check connection".
`;
