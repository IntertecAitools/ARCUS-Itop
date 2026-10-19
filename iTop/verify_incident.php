<?php
require_once '/var/www/html/approot.inc.php';
$oConfig = new Config('/var/www/html/conf/production/config-itop.php');
MetaModel::LoadConfig($oConfig);

// Classes already initialized from previous run
$oClass = MetaModel::GetClass('Incident');
echo 'Incident class loaded: ' . ($oClass ? 'YES' : 'NO') . PHP_EOL;
echo 'Fields count: ' . count($oClass->ListAttributes()) . PHP_EOL;
echo 'Lifecycle states: ' . count($oClass->GetLifecycle()->states) . PHP_EOL;

// List all fields
foreach ($oClass->ListAttributes() as $sAttCode => $oAttDef) {
    echo "  - $sAttCode (" . get_class($oAttDef) . ")" . PHP_EOL;
}