<?php
$sXmlFile = '/var/www/html/datamodels/2.x/itop-incident-mgmt-itil/datamodel.itop-incident-mgmt-itil.xml';
$sXsdFile = '/var/www/html/setup/itop_design.xsd';

echo "Loading XML...\n";
$oDom = new DOMDocument();
$oDom->load($sXmlFile);
echo "XML loaded successfully\n";

echo "Loading XSD...\n";
if (!$oDom->schemaValidate($sXsdFile)) {
    echo "XSD Validation failed:\n";
    // Get validation errors
    $aErrors = libxml_get_errors();
    foreach ($aErrors as $oError) {
        echo "Line {$oError->line}: {$oError->message}\n";
    }
    echo "Total errors: " . count($aErrors) . "\n";
} else {
    echo "XSD Validation passed!\n";
}
libxml_clear_errors();