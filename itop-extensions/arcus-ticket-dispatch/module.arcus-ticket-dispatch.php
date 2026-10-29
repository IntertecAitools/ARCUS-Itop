<?php

/**
 * Arcus: send a ticket to a team before anyone in it takes it.
 *
 * iTop's Incident and UserRequest go from New straight to Assigned, which
 * needs a team AND an agent. This adds a Dispatched state in between: the
 * ticket has a team, no agent yet, and anyone in that team picks it up with
 * the usual Assign. TTO keeps running while it waits. Install:
 * backend/README.md, "Team dispatch and assignment rules".
 */
SetupWebPage::AddModule(
	__FILE__,
	'arcus-ticket-dispatch/1.0.0',
	[
		'label' => 'Arcus: dispatch tickets to a team',
		'category' => 'business',

		'dependencies' => [
			'itop-incident-mgmt-itil/3.0.0',
			'itop-request-mgmt-itil/3.0.0',
			'itop-profiles-itil/3.0.0',
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
