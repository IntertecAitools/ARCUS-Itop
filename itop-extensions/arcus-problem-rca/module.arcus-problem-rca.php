<?php

/**
 * Arcus: root-cause analysis fields on Problem.
 *
 * iTop's Problem has no root cause, workaround or solution (only KnownError
 * does). This adds them, so a problem's analysis is part of the record and
 * can be copied to a known error. Install: backend/README.md, "Problems".
 */
SetupWebPage::AddModule(
	__FILE__,
	'arcus-problem-rca/1.0.0',
	[
		'label' => 'Arcus: root-cause analysis on problems',
		'category' => 'business',

		'dependencies' => [
			'itop-problem-mgmt/3.0.0',
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
