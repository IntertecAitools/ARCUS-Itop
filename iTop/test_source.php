<?php
require_once '/var/www/html/approot.inc.php';
require_once '/var/www/html/core/config.class.inc.php';
require_once '/var/www/html/setup/modelfactory.class.inc.php';
require_once '/var/www/html/setup/itopextension.class.inc.php';

echo "Creating ModelFactory...\n";
$oFactory = new ModelFactory('test', '/var/www/html', 'Test Factory');

// Load ONLY the incident module from source XML
$sModulePath = '/var/www/html/datamodels/2.x/itop-incident-mgmt-itil/datamodel.itop-incident-mgmt-itil.xml';
$oModule = new ItopExtension('itop-incident-mgmt-itil');
$oFactory->LoadModule($oModule);

// Also load dependencies
$aDeps = ['itop-structure', 'itop-config-mgmt', 'itop-tickets'];
foreach ($aDeps as $sDep) {
    $oDep = new ItopExtension($sDep);
    $oFactory->LoadModule($oDep);
}

echo "Applying changes...\n";
$oFactory->ApplyChanges();

echo "Initializing MetaModel...\n";
MetaModel::InitClasses('');

echo "Classes loaded: " . count(MetaModel::GetClasses()) . "\n";

// Run the consistency check
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