<?php

/**
 * Arcus: next-action date on tickets put on hold, and the major-incident flag.
 *
 * iTop has a pending reason but no date to act again, and no way to mark an
 * incident as major. This adds next_action_date to Incident and UserRequest
 * and major_incident to Incident. Install: backend/README.md, "Incidents".
 */
SetupWebPage::AddModule(
	__FILE__,
	'arcus-incident-extras/1.0.0',
	[
		'label' => 'Arcus: next-action date and major incidents',
		'category' => 'business',

		'dependencies' => [
			'itop-incident-mgmt-itil/3.0.0',
			'itop-request-mgmt-itil/3.0.0',
		],
		'mandatory' => false,
		'visible' => true,

		'datamodel' => [],
		'data.struct' => [],
		'data.sample' => [],

		'doc.manual_setup' => '',
		'doc.more_information' => '',

		'settings' => [],
	]
);
