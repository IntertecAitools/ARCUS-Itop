<?php
require_once '/var/www/html/approot.inc.php';
require_once '/var/www/html/setup/modelfactory.class.inc.php';
require_once '/var/www/html/setup/compiler.class.inc.php';

$oFactory = new ModelFactory();
$oFactory->LoadModule('/var/www/html/datamodels/2.x/itop-incident-mgmt-itil/datamodel.itop-incident-mgmt-itil.xml');
echo 'Module loaded successfully';