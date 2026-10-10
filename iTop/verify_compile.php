<?php
require_once '/var/www/html/approot.inc.php';
$oConfig = new Config('/var/www/html/conf/production/config-itop.php');
MetaModel::LoadConfig($oConfig);
// MetaModel::InitClasses($oConfig->Get('db_subname')); // Already initialized

try {
    ob_start();
    MetaModel::CheckDefinitions(false);
    $sOutput = ob_get_clean();
    if (strlen($sOutput) > 0) {
        echo 'Issues found:' . PHP_EOL;
        echo $sOutput;
    } else {
        echo 'No consistency issues found!' . PHP_EOL;
    }
} catch (Exception $e) {
    echo 'Exception: ' . $e->getMessage() . PHP_EOL;
}