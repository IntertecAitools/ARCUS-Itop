<?php
// Use the iTop application bootstrap
require_once '/var/www/html/approot.inc.php';

$oConfig = new Config('/var/www/html/conf/production/config-itop.php');
echo "Config loaded\n";

// Initialize MetaModel
MetaModel::LoadConfig($oConfig);
MetaModel::InitClasses($oConfig->Get('db_subname'));

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