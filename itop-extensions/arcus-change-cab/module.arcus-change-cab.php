<?php

/**
 * Arcus: CAB decisions and change plans.
 *
 * iTop's Change has a fallback (rollback) plan but no implementation or test
 * plan, and nowhere to record a Change Advisory Board's decision. This adds
 * both, and leaves whether a plan is required to the platform's rules (so the
 * fallback plan is no longer mandatory in iTop itself). Install:
 * backend/README.md, "Changes".
 */
SetupWebPage::AddModule(
	__FILE__,
	'arcus-change-cab/1.0.0',
	[
		'label' => 'Arcus: CAB decisions and change plans',
		'category' => 'business',

		'dependencies' => [
			'itop-change-mgmt-itil/3.0.0',
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
