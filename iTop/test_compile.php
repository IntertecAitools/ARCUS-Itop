<?php
require_once '/var/www/html/approot.inc.php';
require_once '/var/www/html/setup/modelfactory.class.inc.php';
require_once '/var/www/html/setup/itopextension.class.inc.php';

// Create a minimal factory
$oFactory = new ModelFactory(
    'test',           // name
    '/var/www/html',  // root dir
    'Test Factory'    // label
);

// Load the core modules first (they define base classes)
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

// Try to compile
try {
    $oCompiler = new MFCompiler($oFactory, 'production');
    $oCompiler->Compile('/var/www/html/env-production', false, false);
    echo "Compilation successful!\n";
} catch (Exception $e) {
    echo "Compilation error: " . $e->getMessage() . "\n";
    echo "Trace: " . $e->getTraceAsString() . "\n";
}