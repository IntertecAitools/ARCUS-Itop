<?php
/**
 * Applies what the platform needs to an installed iTop. Run by itop-setup,
 * as www-data, from the container's environment (docker/itop.env and, through
 * the compose file, docker/prod.env). Safe to run again.
 *
 * - config-itop.php: timezone (ITOP_TIMEZONE, which the BFF reads too), the
 *   SMTP settings iTop sends notifications with, queued sending (the cron
 *   container delivers the queue), and -- when ITOP_EXTERNAL_AUTH_HEADER is
 *   set -- the "external" login reading that header, so staff signed in by
 *   single sign-on call iTop as their UserExternal account.
 * - The BFF's service account ITOP_SERVICE_USER: created if missing, password
 *   set, profiles Administrator + REST Services User. iTop's REST API cannot
 *   give REST Services User to an account that lacks it, which is why this
 *   runs in the container (backend/README.md, "iTop accounts the BFF needs").
 * - REST Services User for the installer's administrator ITOP_ADMIN_USER, so
 *   the first person can sign in to the platform.
 */

const ITOP_ROOT = '/var/www/html/';
const CONFIG_FILE = ITOP_ROOT.'conf/production/config-itop.php';

function env(string $sName, ?string $sDefault = null): ?string
{
	$s = getenv($sName);
	return ($s === false || $s === '') ? $sDefault : $s;
}

function out(string $s): void
{
	echo "configure: $s\n";
}

// --- config-itop.php ---------------------------------------------------------

require_once ITOP_ROOT.'approot.inc.php';
require_once APPROOT.'application/application.inc.php';

$aSettings = [
	'timezone' => env('ITOP_TIMEZONE', 'Europe/Paris'),
	'email_asynchronous' => true,
];
$sSmtpHost = env('ITOP_SMTP_HOST');
if ($sSmtpHost !== null) {
	$aSettings += [
		'email_transport' => 'SMTP',
		'email_transport_smtp.host' => $sSmtpHost,
		'email_transport_smtp.port' => (int)env('ITOP_SMTP_PORT', '587'),
		// tls (STARTTLS), ssl (implicit TLS), or empty for none (a local test mailbox only).
		'email_transport_smtp.encryption' => env('ITOP_SMTP_ENCRYPTION', 'tls') === 'none' ? '' : env('ITOP_SMTP_ENCRYPTION', 'tls'),
		'email_transport_smtp.username' => env('ITOP_SMTP_USER', ''),
		'email_transport_smtp.password' => env('ITOP_SMTP_PASSWORD', ''),
	];
}
if (env('ITOP_MAIL_FROM_ADDRESS') !== null) {
	$aSettings['email_default_sender_address'] = env('ITOP_MAIL_FROM_ADDRESS');
	$aSettings['email_default_sender_label'] = env('ITOP_MAIL_FROM_LABEL', '');
}

// Single sign-on: iTop's "external" login trusts the login in this header,
// which only the BFF sends (iTop is reachable from nowhere else). PHP exposes
// a request header X-Foo-Bar as $_SERVER['HTTP_X_FOO_BAR'], whatever its case.
$sExternalHeader = env('ITOP_EXTERNAL_AUTH_HEADER');
if ($sExternalHeader !== null) {
	if (preg_match('/^[A-Za-z][A-Za-z0-9-]{2,63}$/', $sExternalHeader) !== 1) {
		fwrite(STDERR, "configure: ITOP_EXTERNAL_AUTH_HEADER must be a header name like X-Arcus-Remote-User\n");
		exit(1);
	}
	$aSettings['ext_auth_variable'] = "\$_SERVER['HTTP_".strtoupper(str_replace('-', '_', $sExternalHeader))."']";
}

$oConfig = new Config(CONFIG_FILE);
$bChanged = false;
if ($sExternalHeader !== null && !in_array('external', $oConfig->GetAllowedLoginTypes(), true)) {
	$oConfig->SetAllowedLoginTypes(array_merge($oConfig->GetAllowedLoginTypes(), ['external']));
	$bChanged = true;
	out('allowed external logins (single sign-on)');
}
foreach ($aSettings as $sCode => $value) {
	if ($oConfig->Get($sCode) !== $value) {
		$oConfig->Set($sCode, $value, 'arcus configure.php');
		$bChanged = true;
		out("set $sCode".(str_contains($sCode, 'password') ? '' : ' = '.var_export($value, true)));
	}
}
if ($sSmtpHost === null) {
	out('ITOP_SMTP_HOST is empty: iTop sends no email until it is set');
}
if ($bChanged) {
	// The installer leaves the file read-only.
	chmod(CONFIG_FILE, 0640);
	$oConfig->WriteToFile(CONFIG_FILE);
	chmod(CONFIG_FILE, 0440);
}

// --- Accounts ----------------------------------------------------------------

require_once APPROOT.'application/startup.inc.php';

$sAdmin = env('ITOP_ADMIN_USER', 'admin');
$sServiceUser = env('ITOP_SERVICE_USER');
$sServicePassword = env('ITOP_SERVICE_PASSWORD');
if ($sServiceUser === null || $sServicePassword === null) {
	fwrite(STDERR, "configure: ITOP_SERVICE_USER / ITOP_SERVICE_PASSWORD (ITOP_USER / ITOP_PASSWORD in prod.env) are not set\n");
	exit(1);
}

// Writes need a current user for iTop's change log.
if (!UserRights::Login($sAdmin)) {
	fwrite(STDERR, "configure: no iTop account '$sAdmin' (ITOP_ADMIN_USER)\n");
	exit(1);
}
CMDBObject::SetTrackInfo('arcus configure.php');

function ProfileId(string $sName): int
{
	$oProfile = MetaModel::GetObjectFromOQL('SELECT URP_Profiles WHERE name = :name', ['name' => $sName], false);
	if ($oProfile === null) {
		throw new Exception("iTop has no profile '$sName'");
	}
	return (int)$oProfile->GetKey();
}

/** Adds the profiles the account lacks; returns the names added. */
function AddProfiles(User $oUser, array $aProfileNames): array
{
	$oSet = $oUser->Get('profile_list');
	$aHave = [];
	while ($oLink = $oSet->Fetch()) {
		$aHave[] = (int)$oLink->Get('profileid');
	}
	$aAdded = [];
	foreach ($aProfileNames as $sName) {
		$iId = ProfileId($sName);
		if (!in_array($iId, $aHave, true)) {
			$oSet->AddItem(MetaModel::NewObject('URP_UserProfile', ['profileid' => $iId, 'reason' => 'Arcus platform']));
			$aAdded[] = $sName;
		}
	}
	$oUser->Set('profile_list', $oSet);
	return $aAdded;
}

$aServiceProfiles = ['Administrator', 'REST Services User'];
$oService = MetaModel::GetObjectFromOQL('SELECT UserLocal WHERE login = :login', ['login' => $sServiceUser], false);
if ($oService === null) {
	$oService = MetaModel::NewObject('UserLocal', [
		'login' => $sServiceUser,
		'language' => env('ITOP_LANGUAGE', 'EN US'),
		'status' => 'enabled',
		'expiration' => 'never_expire',
	]);
	$oService->Set('password', $sServicePassword);
	AddProfiles($oService, $aServiceProfiles);
	$oService->DBInsert();
	out("created service account '$sServiceUser' (".implode(' + ', $aServiceProfiles).')');
} else {
	$aAdded = AddProfiles($oService, $aServiceProfiles);
	if (!UserRights::CheckCredentials($sServiceUser, $sServicePassword)) {
		$oService->Set('password', $sServicePassword);
		out("service account '$sServiceUser': password updated");
	}
	$oService->Set('status', 'enabled');
	$oService->DBUpdate();
	out("service account '$sServiceUser' ready".($aAdded ? ', added '.implode(' + ', $aAdded) : ''));
}

$oAdmin = MetaModel::GetObjectFromOQL('SELECT User WHERE login = :login', ['login' => $sAdmin], false);
$aAdded = AddProfiles($oAdmin, ['REST Services User']);
if ($aAdded) {
	$oAdmin->DBUpdate();
	out("administrator '$sAdmin': added REST Services User");
}

out('ok');
