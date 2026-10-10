<?php
require_once '/var/www/html/approot.inc.php';
require_once '/var/www/html/core/config.class.inc.php';
require_once '/var/www/html/core/metamodel.class.php';
require_once '/var/www/html/setup/modelfactory.class.inc.php';
require_once '/var/www/html/setup/itopextension.class.inc.php';

echo "Creating ModelFactory...\n";
$oFactory = new ModelFactory('test', '/var/www/html', 'Test Factory');

$aCoreModules = [
    'itop-structure',
    'itop-config-mgmt',
    'itop-tickets',
    'itop-incident-mgmt-itil',
];

foreach ($aCoreModules as $sModuleId) {
    try {
        $oModule = new ItopExtension($sModuleId);
        $oFactory->LoadModule($oModule);
        echo "Loaded: $sModuleId\n";
    } catch (Exception $e) {
        echo "Error loading $sModuleId: " . $e->getMessage() . "\n";
    }
}

echo "Applying changes...\n";
$oFactory->ApplyChanges();

echo "Initializing MetaModel...\n";
MetaModel::InitClasses('');

echo "Classes count: " . count(MetaModel::GetClasses()) . "\n";

// Try to run the consistency check
try {
    ob_start();
    MetaModel::CheckDefinitions(false);
    $sOutput = ob_get_clean();
    if (strlen($sOutput) > 0) {
        echo "Consistency issues found:\n";
        echo $sOutput;
    } else {
        echo "No consistency issues found!\n";
    }
} catch (Exception $e) {
    echo "Exception: " . $e->getMessage() . "\n";
    echo "Trace: " . $e->getTraceAsString() . "\n";
}