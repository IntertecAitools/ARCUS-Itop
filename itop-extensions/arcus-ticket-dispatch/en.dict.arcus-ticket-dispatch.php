<?php

Dict::Add('EN US', 'English', 'English', [
	'Class:Incident/Attribute:status/Value:dispatched' => 'Dispatched',
	'Class:Incident/Attribute:status/Value:dispatched+' => 'Sent to a team; nobody in it has taken it yet',
	'Class:Incident/Attribute:dispatch_date' => 'Dispatch date',
	'Class:Incident/Attribute:dispatch_date+' => 'When the incident was last sent to a team',
	'Class:Incident/Stimulus:ev_dispatch' => 'Dispatch to team',
	'Class:Incident/Stimulus:ev_dispatch+' => 'Send the incident to a team without choosing the agent',

	'Class:UserRequest/Attribute:status/Value:dispatched' => 'Dispatched',
	'Class:UserRequest/Attribute:status/Value:dispatched+' => 'Sent to a team; nobody in it has taken it yet',
	'Class:UserRequest/Attribute:dispatch_date' => 'Dispatch date',
	'Class:UserRequest/Attribute:dispatch_date+' => 'When the request was last sent to a team',
	'Class:UserRequest/Stimulus:ev_dispatch' => 'Dispatch to team',
	'Class:UserRequest/Stimulus:ev_dispatch+' => 'Send the request to a team without choosing the agent',
]);
