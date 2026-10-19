<?php
require_once '/var/www/html/approot.inc.php';
require_once '/var/www/html/core/config.class.inc.php';
require_once '/var/www/html/setup/modelfactory.class.inc.php';
require_once '/var/www/html/setup/itopextension.class.inc.php';
require_once '/var/www/html/setup/compiler.class.inc.php';

echo "Creating ModelFactory...\n";
$oFactory = new ModelFactory(
    '/var/www/html/datamodels/2.x',
    'Test Factory'
);

$aModules = [
    'itop-structure',
    'itop-config-mgmt',
    'itop-tickets',
    'itop-incident-mgmt-itil',
];

foreach ($aModules as $sModuleId) {
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

echo "Classes loaded: " . count(MetaModel::GetClasses()) . "\n";

// Try to compile
try {
    $oCompiler = new MFCompiler($oFactory, 'production');
    $oCompiler->Compile('/var/www/html/env-production-test', false, false);
    echo "Compilation successful!\n";
} catch (Exception $e) {
    echo "Compilation error: " . $e->getMessage() . "\n";
    echo "Trace: " . $e->getTraceAsString() . "\n";
}