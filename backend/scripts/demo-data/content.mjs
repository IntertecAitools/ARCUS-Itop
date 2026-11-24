/**
 * What the demo data says: an IT operations provider (the installation's own
 * organisation) running IT for client companies in the UAE. Every company,
 * person and domain here is made up. Product and vendor names (Dell, Cisco,
 * Microsoft...) appear only as the equipment and software a real IT desk
 * looks after.
 */

export const PROVIDER_DOMAIN = 'iraops.ae';

/** Client companies: [name, short code, email domain, sector, staff count, home city]. */
export const CLIENTS = [
  ['Qasr Al Bahr Hospitality', 'QAB', 'qasralbahr-hotels.ae', 'hospitality', 42, 'Dubai'],
  ['Wadi Crest Logistics', 'WCL', 'wadicrest-logistics.ae', 'logistics', 38, 'Dubai'],
  ['Marjan Bay Medical Centres', 'MBM', 'marjanbay-medical.ae', 'healthcare', 40, 'Abu Dhabi'],
  ['Sahraa Retail Holdings', 'SRH', 'sahraa-retail.ae', 'retail', 34, 'Sharjah'],
  ['Falconridge Engineering Consultants', 'FEC', 'falconridge-eng.ae', 'engineering', 26, 'Abu Dhabi'],
  ['Palmhaven Properties', 'PHP', 'palmhaven-properties.ae', 'real estate', 24, 'Dubai'],
  ['Dhow Harbour Shipping', 'DHS', 'dhowharbour-shipping.ae', 'shipping', 22, 'Ras Al Khaimah'],
  ['Saqr Valley Schools', 'SVS', 'saqrvalley-schools.ae', 'education', 30, 'Al Ain'],
  ['Corniche Capital Finance', 'CCF', 'cornichecapital.ae', 'finance', 28, 'Abu Dhabi'],
  ['Liwa Cooling & Power', 'LCP', 'liwa-coolingpower.ae', 'utilities', 26, 'Abu Dhabi'],
];

/** Offices: [org code or 'IRA', name, address, city, postal code]. */
export const LOCATIONS = [
  ['IRA', 'IRAOPS HQ - Business Bay', 'Level 14, Bay Square Tower 7, Business Bay', 'Dubai', '125334'],
  ['IRA', 'IRAOPS Operations Centre - Al Maryah', 'Floor 9, Al Sila Tower, Al Maryah Island', 'Abu Dhabi', '764521'],
  ['IRA', 'IRAOPS Field Depot - Al Quoz', 'Warehouse 12, Al Quoz Industrial Area 3', 'Dubai', '391877'],
  ['QAB', 'Qasr Al Bahr - Jumeirah Beach Resort', 'Jumeirah Beach Road, Umm Suqeim 3', 'Dubai', '213004'],
  ['QAB', 'Qasr Al Bahr - Corporate Office', 'Office 2104, Marina Plaza, Dubai Marina', 'Dubai', '211932'],
  ['QAB', 'Qasr Al Bahr - Saadiyat Hotel', 'Saadiyat Cultural District', 'Abu Dhabi', '761048'],
  ['WCL', 'Wadi Crest - Jebel Ali Hub', 'Plot S30214, Jebel Ali Free Zone South', 'Dubai', '262517'],
  ['WCL', 'Wadi Crest - Head Office', 'Office 805, JLT Cluster X, Jumeirah Lake Towers', 'Dubai', '336140'],
  ['WCL', 'Wadi Crest - KEZAD Warehouse', 'KEZAD Logistics Park, Block B', 'Abu Dhabi', '764902'],
  ['MBM', 'Marjan Bay - Khalifa City Clinic', 'Street 18, Khalifa City A', 'Abu Dhabi', '761227'],
  ['MBM', 'Marjan Bay - Al Reem Day Surgery', 'Shams Boutik Building, Al Reem Island', 'Abu Dhabi', '760493'],
  ['MBM', 'Marjan Bay - Mussafah Clinic', 'M-37, Mussafah Industrial', 'Abu Dhabi', '762116'],
  ['SRH', 'Sahraa Retail - Head Office', 'Al Majaz Business Centre, Al Majaz 3', 'Sharjah', '275109'],
  ['SRH', 'Sahraa Retail - SAIF Zone Distribution', 'Q4-112, SAIF Zone', 'Sharjah', '275873'],
  ['SRH', 'Sahraa Retail - Deira Store', 'Al Rigga Road, Deira', 'Dubai', '233761'],
  ['FEC', 'Falconridge - Main Office', 'Floor 6, Al Bateen Towers, Al Bateen', 'Abu Dhabi', '760115'],
  ['FEC', 'Falconridge - Dubai Studio', 'Office 304, Dubai Design District Building 6', 'Dubai', '334582'],
  ['PHP', 'Palmhaven - Sales Gallery', 'Sheikh Zayed Road, Al Barsha 1', 'Dubai', '391460'],
  ['PHP', 'Palmhaven - Community Office', 'Arabian Ranches 3 Community Centre', 'Dubai', '391983'],
  ['DHS', 'Dhow Harbour - Port Office', 'Saqr Port, Khor Khuwair', 'Ras Al Khaimah', '312784'],
  ['DHS', 'Dhow Harbour - Dubai Liaison', 'Office 1210, Port Saeed Tower, Deira', 'Dubai', '233119'],
  ['SVS', 'Saqr Valley - Al Ain Campus', 'Al Jimi District', 'Al Ain', '764311'],
  ['SVS', 'Saqr Valley - Al Ain North Campus', 'Al Hili District', 'Al Ain', '764872'],
  ['CCF', 'Corniche Capital - Head Office', 'Floor 22, Corniche Tower, Corniche Road West', 'Abu Dhabi', '760004'],
  ['CCF', 'Corniche Capital - Dubai Branch', 'Office 1702, Gate Village 3, DIFC', 'Dubai', '507311'],
  ['LCP', 'Liwa Cooling - Plant 2 Control Room', 'Mussafah Industrial, Sector M-44', 'Abu Dhabi', '762788'],
  ['LCP', 'Liwa Cooling - Corporate Office', 'Floor 11, Al Khatem Tower, Al Maryah Island', 'Abu Dhabi', '764095'],
];

/** First names by background, mixed the way a UAE workforce is. */
export const FIRST_NAMES = {
  arab: ['Ahmed', 'Mohammed', 'Khalid', 'Omar', 'Yousef', 'Hamad', 'Saif', 'Rashid', 'Faisal', 'Tariq', 'Hassan', 'Ali', 'Majid', 'Sultan', 'Nasser', 'Fatima', 'Mariam', 'Aisha', 'Noura', 'Hessa', 'Shamma', 'Layla', 'Reem', 'Sara', 'Dana', 'Amna', 'Hind', 'Rania', 'Lina', 'Nadia', 'Kareem', 'Ziad', 'Bilal', 'Hala', 'Yara', 'Salma', 'Mona', 'Samir', 'Walid', 'Jamal'],
  southAsian: ['Rahul', 'Arjun', 'Vikram', 'Suresh', 'Anil', 'Rohan', 'Karthik', 'Imran', 'Faisal', 'Usman', 'Bilal', 'Priya', 'Divya', 'Anjali', 'Sneha', 'Kavya', 'Meera', 'Ayesha', 'Sana', 'Nida', 'Deepak', 'Manoj', 'Nikhil', 'Sanjay', 'Ravi', 'Shreya', 'Pooja', 'Asif', 'Hamza', 'Zainab'],
  filipino: ['Mark', 'John Paul', 'Jerome', 'Ramon', 'Carlo', 'Joseph', 'Angelica', 'Maricel', 'Kristine', 'Jasmine', 'Rowena', 'Lorna', 'Jonathan', 'Rhea', 'Aileen'],
  western: ['James', 'Oliver', 'Daniel', 'Thomas', 'Michael', 'David', 'Sophie', 'Emma', 'Charlotte', 'Hannah', 'Claire', 'Lucy', 'Matthew', 'Andrew', 'Rebecca', 'Laura', 'Peter', 'Natalie'],
  other: ['Elena', 'Dmitri', 'Katarina', 'Marco', 'Luca', 'Ines', 'Tunde', 'Chiamaka', 'Kwame', 'Grace', 'Hyun', 'Mei', 'Andrei', 'Petra'],
};

export const LAST_NAMES = {
  arab: ['Al Mansoori', 'Al Hashimi', 'Al Nuaimi', 'Al Mazrouei', 'Al Shamsi', 'Al Ketbi', 'Al Dhaheri', 'Al Falasi', 'Al Suwaidi', 'Al Marri', 'Haddad', 'Khoury', 'Nasser', 'Saleh', 'Farouk', 'Abdallah', 'Mahmoud', 'Youssef', 'Hamdan', 'El Sayed', 'Barakat', 'Aziz', 'Rahman', 'Qasim', 'Al Zaabi', 'Al Kaabi', 'Al Blooshi', 'Ibrahim', 'Mansour', 'Darwish'],
  southAsian: ['Sharma', 'Nair', 'Menon', 'Pillai', 'Iyer', 'Reddy', 'Gupta', 'Khan', 'Qureshi', 'Siddiqui', 'Patel', 'Mehta', 'Joshi', 'Kapoor', 'Fernandes', 'D\'Souza', 'Chaudhry', 'Malik', 'Hussain', 'Varghese', 'Thomas', 'Kurian', 'Shetty', 'Rao', 'Krishnan'],
  filipino: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Dela Cruz', 'Villanueva', 'Ramos', 'Aquino', 'Castillo', 'Navarro'],
  western: ['Walker', 'Bennett', 'Harrison', 'Clarke', 'Murphy', 'O\'Connor', 'Fletcher', 'Reid', 'Morgan', 'Hughes', 'Turner', 'Price', 'Collins', 'Grant'],
  other: ['Petrova', 'Ivanov', 'Rossi', 'Bianchi', 'Okafor', 'Adeyemi', 'Mensah', 'Park', 'Chen', 'Novak', 'Horvat', 'Lopes'],
};

/** Weights of each background in a client workforce and in the IT staff. */
export const MIX = { arab: 0.34, southAsian: 0.34, filipino: 0.14, western: 0.1, other: 0.08 };

export const CLIENT_FUNCTIONS = {
  hospitality: ['Front Office Manager', 'Guest Relations Executive', 'Revenue Manager', 'Housekeeping Supervisor', 'F&B Manager', 'Night Auditor', 'Reservations Agent', 'Finance Executive', 'HR Coordinator', 'Concierge'],
  logistics: ['Warehouse Supervisor', 'Fleet Coordinator', 'Customs Clearance Officer', 'Operations Manager', 'Inventory Controller', 'Dispatcher', 'Accountant', 'Procurement Officer', 'HSE Officer', 'Customer Service Executive'],
  healthcare: ['Staff Nurse', 'Medical Receptionist', 'Radiology Technician', 'Pharmacist', 'Clinic Manager', 'Insurance Coordinator', 'Medical Records Officer', 'Lab Technician', 'General Practitioner', 'Billing Officer'],
  retail: ['Store Manager', 'Visual Merchandiser', 'Category Buyer', 'Cashier Supervisor', 'E-commerce Executive', 'Inventory Analyst', 'Marketing Executive', 'Finance Manager', 'HR Officer', 'Area Manager'],
  engineering: ['Senior Structural Engineer', 'BIM Coordinator', 'Project Manager', 'MEP Engineer', 'Document Controller', 'Quantity Surveyor', 'Architect', 'CAD Technician', 'Contracts Manager', 'Office Administrator'],
  'real estate': ['Sales Consultant', 'Leasing Executive', 'Property Manager', 'Community Manager', 'Marketing Manager', 'CRM Executive', 'Finance Executive', 'Legal Counsel', 'Facilities Coordinator', 'Customer Care Officer'],
  shipping: ['Marine Superintendent', 'Chartering Manager', 'Port Agent', 'Documentation Officer', 'Crewing Coordinator', 'Accounts Executive', 'Operations Executive', 'Technical Superintendent', 'Bunker Trader', 'HR Officer'],
  education: ['Teacher', 'Head of Department', 'Admissions Officer', 'School Registrar', 'IT Coordinator', 'Librarian', 'Principal', 'Finance Officer', 'Nurse', 'Transport Coordinator'],
  finance: ['Relationship Manager', 'Credit Analyst', 'Compliance Officer', 'Treasury Dealer', 'Operations Officer', 'Branch Manager', 'Risk Analyst', 'Internal Auditor', 'Finance Controller', 'Customer Service Officer'],
  utilities: ['Control Room Operator', 'Maintenance Engineer', 'Plant Manager', 'SCADA Engineer', 'HSE Advisor', 'Planning Engineer', 'Procurement Officer', 'Finance Analyst', 'Electrical Technician', 'Document Controller'],
};

/** IRAOPS's own teams: [name, function, email local part, members]. */
export const TEAMS = [
  ['Service Desk', 'First line: calls, portal and email, 7 days a week', 'servicedesk', 9],
  ['Desktop Support - Dubai', 'On-site end-user support for Dubai and Sharjah clients', 'desktop.dubai', 6],
  ['Desktop Support - Abu Dhabi', 'On-site end-user support for Abu Dhabi, Al Ain and RAK clients', 'desktop.abudhabi', 5],
  ['Network Operations', 'LAN, WAN, Wi-Fi, firewalls and SD-WAN', 'noc', 5],
  ['Server & Cloud', 'Windows and Linux servers, VMware, Azure and backups', 'cloudops', 5],
  ['Business Applications', 'ERP, CRM, HIS, POS and line-of-business applications', 'apps', 5],
  ['Security Operations', 'Endpoint protection, identity, email security and incident response', 'soc', 4],
  ['Service Management', 'Change management, problem management and service reviews', 'itsm', 3],
];

export const IT_FUNCTIONS = {
  'Service Desk': ['Service Desk Analyst', 'Service Desk Analyst', 'Senior Service Desk Analyst', 'Service Desk Team Lead'],
  'Desktop Support - Dubai': ['Desktop Support Engineer', 'Field Engineer', 'Senior Desktop Engineer'],
  'Desktop Support - Abu Dhabi': ['Desktop Support Engineer', 'Field Engineer', 'Senior Desktop Engineer'],
  'Network Operations': ['Network Engineer', 'Senior Network Engineer', 'NOC Lead'],
  'Server & Cloud': ['Systems Engineer', 'Cloud Engineer', 'Senior Systems Engineer'],
  'Business Applications': ['Applications Analyst', 'ERP Consultant', 'Applications Team Lead'],
  'Security Operations': ['Security Analyst', 'SOC Lead'],
  'Service Management': ['Change Manager', 'Problem Manager', 'Service Delivery Manager'],
};

/**
 * Service catalogue: family -> services -> subcategories. A subcategory is
 * [name, 'incident' | 'service_request', team that handles it].
 */
export const CATALOGUE = [
  ['End-User Computing', [
    ['Laptops & Desktops', [['Hardware fault', 'incident', 'Desktop'], ['Performance issue', 'incident', 'Desktop'], ['New laptop or desktop', 'service_request', 'Desktop'], ['Hardware upgrade', 'service_request', 'Desktop']]],
    ['Printing & Scanning', [['Printer not working', 'incident', 'Desktop'], ['Scan to email or folder', 'incident', 'Desktop'], ['Add a printer', 'service_request', 'Desktop']]],
    ['Mobile Devices', [['Phone or tablet issue', 'incident', 'Desktop'], ['New mobile device', 'service_request', 'Desktop'], ['Mobile email setup', 'service_request', 'Service Desk']]],
    ['Software Installation', [['Application crash', 'incident', 'Service Desk'], ['Install software', 'service_request', 'Service Desk'], ['Software licence request', 'service_request', 'Service Desk']]],
  ]],
  ['Collaboration', [
    ['Email & Calendar', [['Cannot send or receive email', 'incident', 'Service Desk'], ['Outlook issue', 'incident', 'Service Desk'], ['Shared mailbox or distribution list', 'service_request', 'Service Desk'], ['Mailbox size increase', 'service_request', 'Service Desk']]],
    ['Microsoft Teams & Meetings', [['Teams call or meeting problem', 'incident', 'Service Desk'], ['Meeting room AV fault', 'incident', 'Desktop'], ['New Teams team or channel', 'service_request', 'Service Desk']]],
    ['File Sharing', [['Cannot open shared files', 'incident', 'Service Desk'], ['Access to a shared folder', 'service_request', 'Service Desk'], ['Restore a deleted file', 'service_request', 'Server & Cloud']]],
  ]],
  ['Identity & Access', [
    ['User Accounts', [['Account locked out', 'incident', 'Service Desk'], ['Password reset', 'service_request', 'Service Desk'], ['New starter account', 'service_request', 'Service Desk'], ['Leaver account removal', 'service_request', 'Service Desk']]],
    ['Remote Access', [['VPN cannot connect', 'incident', 'Network Operations'], ['VPN access request', 'service_request', 'Network Operations']]],
    ['Multi-Factor Authentication', [['MFA prompt not received', 'incident', 'Security Operations'], ['Register a new phone for MFA', 'service_request', 'Service Desk']]],
  ]],
  ['Network & Connectivity', [
    ['Office Network', [['No network connection', 'incident', 'Network Operations'], ['Slow network', 'incident', 'Network Operations'], ['New network point', 'service_request', 'Network Operations']]],
    ['Wi-Fi', [['Wi-Fi drops or no signal', 'incident', 'Network Operations'], ['Guest Wi-Fi access', 'service_request', 'Network Operations']]],
    ['Internet & WAN', [['Site internet outage', 'incident', 'Network Operations'], ['Firewall rule change', 'service_request', 'Network Operations']]],
  ]],
  ['Infrastructure & Cloud', [
    ['Servers & Virtualisation', [['Server down or unresponsive', 'incident', 'Server & Cloud'], ['Disk space alert', 'incident', 'Server & Cloud'], ['New virtual machine', 'service_request', 'Server & Cloud']]],
    ['Backup & Recovery', [['Backup job failed', 'incident', 'Server & Cloud'], ['Restore request', 'service_request', 'Server & Cloud']]],
    ['Azure Cloud Services', [['Cloud service degraded', 'incident', 'Server & Cloud'], ['Cloud resource request', 'service_request', 'Server & Cloud']]],
  ]],
  ['Business Applications', [
    ['ERP (Microsoft Dynamics 365)', [['ERP error or slowness', 'incident', 'Business Applications'], ['ERP user access', 'service_request', 'Business Applications'], ['ERP report request', 'service_request', 'Business Applications']]],
    ['CRM (Salesforce)', [['CRM issue', 'incident', 'Business Applications'], ['CRM user or role change', 'service_request', 'Business Applications']]],
    ['Point of Sale', [['POS terminal fault', 'incident', 'Business Applications'], ['New POS terminal', 'service_request', 'Business Applications']]],
    ['Clinical Systems (HIS)', [['HIS module error', 'incident', 'Business Applications'], ['HIS user access', 'service_request', 'Business Applications']]],
    ['Property Management System', [['PMS or key card issue', 'incident', 'Business Applications'], ['PMS user access', 'service_request', 'Business Applications']]],
  ]],
  ['Security', [
    ['Endpoint Protection', [['Malware alert', 'incident', 'Security Operations'], ['Antivirus exclusion', 'service_request', 'Security Operations']]],
    ['Email Security', [['Phishing email reported', 'incident', 'Security Operations'], ['Release quarantined email', 'service_request', 'Security Operations']]],
  ]],
];

/** Services that only some sectors use. */
export const SECTOR_SERVICES = {
  'Point of Sale': ['retail', 'hospitality'],
  'Clinical Systems (HIS)': ['healthcare'],
  'Property Management System': ['hospitality', 'real estate'],
  'CRM (Salesforce)': ['real estate', 'finance', 'retail', 'logistics', 'shipping'],
};

/** Equipment catalogue: brand -> models with a kind. */
export const MODELS = [
  ['Dell', [['Latitude 5440', 'PC'], ['Latitude 7440', 'PC'], ['OptiPlex 7010', 'PC'], ['PowerEdge R760', 'Server'], ['PowerEdge R660', 'Server'], ['P2423D Monitor', 'Peripheral']]],
  ['HP', [['EliteBook 840 G10', 'PC'], ['ProBook 450 G10', 'PC'], ['EliteDesk 800 G9', 'PC'], ['LaserJet Enterprise M611', 'Printer'], ['Color LaserJet MFP M480', 'Printer'], ['ProLiant DL380 Gen11', 'Server']]],
  ['Lenovo', [['ThinkPad T14 Gen 4', 'PC'], ['ThinkPad X1 Carbon Gen 11', 'PC'], ['ThinkCentre M70q', 'PC']]],
  ['Apple', [['MacBook Air M2', 'PC'], ['iPhone 15', 'MobilePhone'], ['iPad 10th generation', 'Tablet']]],
  ['Samsung', [['Galaxy S23', 'MobilePhone'], ['Galaxy Tab S9', 'Tablet'], ['Galaxy A54', 'MobilePhone']]],
  ['Cisco', [['Catalyst 9200L-48P', 'NetworkDevice'], ['Catalyst 9300-24P', 'NetworkDevice'], ['Meraki MR46', 'NetworkDevice'], ['ISR 1121', 'NetworkDevice']]],
  ['Fortinet', [['FortiGate 100F', 'NetworkDevice'], ['FortiGate 60F', 'NetworkDevice']]],
  ['Canon', [['imageRUNNER ADVANCE DX C3826i', 'Printer']]],
  ['Zebra', [['ZD421 Label Printer', 'Printer'], ['TC52 Handheld', 'MobilePhone']]],
];

export const OS = [
  ['Windows', ['Windows 11 Enterprise 23H2', 'Windows 11 Enterprise 22H2', 'Windows 10 Enterprise 22H2']],
  ['Windows Server', ['Windows Server 2022 Standard', 'Windows Server 2019 Standard']],
  ['Linux', ['Ubuntu 22.04 LTS', 'Red Hat Enterprise Linux 9']],
  ['macOS', ['macOS Sonoma 14']],
  ['iOS', ['iOS 17']],
  ['Android', ['Android 14']],
];

/** Business applications per sector (ApplicationSolution names, prefixed with the client code). */
export const APPLICATIONS = {
  all: ['Microsoft 365', 'Dynamics 365 Finance', 'Active Directory', 'File Services', 'Backup (Veeam)'],
  hospitality: ['Opera PMS', 'Micros POS', 'Guest Wi-Fi Portal'],
  logistics: ['Warehouse Management System', 'Fleet Tracking', 'Customs Portal Integration'],
  healthcare: ['HIS - Patient Administration', 'PACS Imaging', 'Laboratory Information System', 'e-Claims (Insurance)'],
  retail: ['LS Central POS', 'E-commerce Storefront', 'Loyalty Programme'],
  engineering: ['Autodesk BIM 360', 'Project Controls (Primavera)', 'Document Control (Aconex)'],
  'real estate': ['Salesforce CRM', 'Property Management (Yardi)', 'Customer Portal'],
  shipping: ['Voyage Management System', 'Crewing System', 'Salesforce CRM'],
  education: ['Student Information System', 'Learning Management (Moodle)', 'Parent Portal'],
  finance: ['Core Banking Interface', 'Salesforce CRM', 'Treasury Management', 'AML Screening'],
  utilities: ['SCADA Historian', 'Maintenance (IBM Maximo)', 'GIS Viewer'],
};

/**
 * Incident stories, per subcategory. Each: title, what the caller wrote, the
 * conversation, the fix, the resolution code. {site}, {app}, {device},
 * {floor} and {person} are filled in per ticket.
 */
export const INCIDENTS = {
  'Hardware fault': [
    ['Laptop does not power on after the weekend', 'My laptop will not switch on at all. The charging light comes on but the screen stays black. I need it for a client meeting at 11.', ['Asked the user to hold the power button for 30 seconds with the charger disconnected.', 'Still no display. Engineer booked for a visit at {site}.', 'On site: the motherboard has failed. Swapped the user to a loan laptop and restored their profile from OneDrive.'], 'Replaced with a loan unit; faulty unit sent to Dell under warranty.', 'hardware repair'],
    ['Keyboard keys not working on {device}', 'Several keys (E, R and the space bar) stopped responding this morning. An external keyboard works.', ['Checked the keyboard driver and ran Dell diagnostics: keyboard test failed.', 'Warranty case opened with the vendor. Part arrives in two days.', 'Keyboard replaced on site, all keys tested with the user.'], 'Keyboard replaced under warranty.', 'hardware repair'],
    ['Docking station not detecting monitors', 'When I connect to the dock at my desk on {floor} neither of my two monitors shows anything. It worked yesterday.', ['Updated the dock firmware and the display driver remotely.', 'Monitors detected after the update; asked the user to test with a restart.', 'User confirmed both screens work after a restart.'], 'Dock firmware and display driver updated.', 'software patch'],
    ['Laptop battery swelling', 'The touchpad on my laptop is raised and the case does not close properly. I think the battery is swollen.', ['Advised the user to shut down and stop charging the laptop immediately.', 'Collected the device from {site} and issued a spare.', 'Battery replaced by the vendor; device returned and checked.'], 'Swollen battery replaced, spare returned to stock.', 'hardware repair'],
    ['Blue screen several times a day', 'My computer restarts with a blue screen 3-4 times a day, usually when I join Teams calls.', ['Collected the minidumps: the crash is in the Wi-Fi driver.', 'Rolled the Intel Wi-Fi driver to the validated version and blocked the faulty update.', 'No crash in 3 days, user confirmed.'], 'Wi-Fi driver rolled back to the validated version.', 'software patch'],
  ],
  'Performance issue': [
    ['Computer extremely slow after updates', 'Since the update last night everything is slow: Outlook takes 5 minutes to open and Excel freezes.', ['Remote session: disk at 100% from a stuck Windows Update service.', 'Cleared the update cache and completed the pending update.', 'Performance back to normal, user confirmed.'], 'Stuck Windows Update completed and cache cleared.', 'system update'],
    ['Laptop very slow when opening large drawings', 'Opening our Revit models now takes more than 10 minutes, it used to be 2.', ['Checked: 8 GB RAM, memory at 98% when the model opens.', 'Approved a RAM upgrade to 32 GB for the engineering workstation profile.', 'RAM upgraded; model opens in under 2 minutes.'], 'Memory upgraded to 32 GB.', 'hardware repair'],
    ['Desktop freezing every few minutes', 'My PC freezes for about 30 seconds every few minutes, especially in the ERP.', ['Found a full system drive (2 GB free).', 'Cleaned temp files and moved old downloads to OneDrive with the user.', 'Now 96 GB free, no more freezes.'], 'Freed disk space and enabled Storage Sense.', 'assistance'],
  ],
  'Printer not working': [
    ['Printer on {floor} shows paper jam but there is no paper stuck', 'The printer near the pantry on {floor} keeps saying paper jam in tray 2. We checked and there is nothing inside.', ['Asked the user for a photo of the error code: 13.B2.D2.', 'Engineer on site: the tray 2 pickup roller is worn.', 'Roller replaced, 50 test pages printed without a jam.'], 'Replaced the tray 2 pickup roller.', 'hardware repair'],
    ['Cannot print to the finance printer', 'Nobody in finance can print since this morning. Jobs stay in the queue.', ['Print spooler on the print server stopped after a patch reboot.', 'Restarted the spooler and cleared the stuck jobs.', 'Finance team confirmed printing works.'], 'Restarted the print spooler, cleared the queue.', 'assistance'],
    ['Printing comes out with grey streaks', 'All pages from the reception printer have grey lines down the page.', ['Drum unit near end of life according to the printer report.', 'Replaced the drum and toner.', 'Print quality checked with the user.'], 'Replaced the drum unit.', 'hardware repair'],
  ],
  'Scan to email or folder': [
    ['Scan to email stopped working', 'The scanner says "SMTP error" when we scan to email.', ['The scanner relay account password expired.', 'Moved the scanner to the authenticated relay with a non-expiring app password.', 'Test scans received by the team.'], 'Updated the scanner relay settings.', 'other'],
  ],
  'Phone or tablet issue': [
    ['Company iPhone not syncing email', 'Since I changed my password my iPhone no longer receives work email.', ['Removed and re-added the work profile in Intune Company Portal.', 'Mail syncing again.'], 'Re-enrolled the device profile.', 'assistance'],
    ['Handheld scanner not connecting to warehouse Wi-Fi', 'Three of the Zebra handhelds in zone C cannot connect to the warehouse network.', ['Certificates on the handhelds expired yesterday.', 'Pushed the renewed certificate from the device management console.', 'All three scanners back online.'], 'Renewed the device Wi-Fi certificate.', 'system update'],
  ],
  'Application crash': [
    ['Excel crashes when opening macro workbooks', 'Excel closes immediately when I open the monthly reconciliation workbook. Other files are fine.', ['The workbook uses a blocked legacy add-in.', 'Installed the approved version of the add-in and trusted the finance share location.', 'User opened the workbook successfully.'], 'Installed the supported add-in version.', 'software patch'],
    ['Adobe Acrobat freezes when signing PDFs', 'Acrobat stops responding whenever I try to sign a document.', ['Known issue with the current Acrobat build and the e-signature plugin.', 'Updated Acrobat to the latest release.', 'Signing works again.'], 'Updated Adobe Acrobat.', 'software patch'],
  ],
  'Cannot send or receive email': [
    ['Emails to external clients bouncing back', 'Emails I send to clients outside the company come back with "message blocked". Internal email works.', ['The user mailbox was restricted after sending a large number of messages.', 'Confirmed with the user it was a legitimate mail-merge; released the restriction.', 'Advised using the marketing platform for bulk sends.'], 'Removed the outbound restriction and advised on bulk email.', 'assistance'],
    ['Not receiving any new emails since 9am', 'My inbox has not received anything since 9am but colleagues say they emailed me.', ['An inbox rule was moving all mail to an archive folder.', 'Removed the rule with the user.', 'Mail flow confirmed.'], 'Removed an incorrect inbox rule.', 'assistance'],
  ],
  'Outlook issue': [
    ['Outlook keeps asking for password', 'Outlook asks me for my password every few minutes even though I type it correctly.', ['Cached credentials corrupted after the password change.', 'Cleared Credential Manager entries and rebuilt the Outlook profile.', 'No more prompts, user confirmed next day.'], 'Rebuilt the Outlook profile and cleared stale credentials.', 'assistance'],
    ['Shared calendar not updating', 'The meeting rooms calendar shows old bookings and new ones do not appear.', ['Outlook cached mode was stuck on the shared calendar.', 'Turned off shared folder caching for this user.', 'Calendar now up to date.'], 'Changed Outlook cache settings for shared calendars.', 'assistance'],
  ],
  'Teams call or meeting problem': [
    ['Teams audio drops during calls', 'People say my voice cuts out on Teams calls. It happens at my desk and at home.', ['Call quality dashboard shows packet loss from the USB headset.', 'Replaced the headset with a certified model.', 'Two test calls clean.'], 'Replaced the faulty headset.', 'hardware repair'],
    ['Cannot share screen in Teams meetings', 'When I click Share the button is greyed out in all meetings.', ['Meeting policy for the user was the restricted policy from the trainee group.', 'Moved the user to the standard meeting policy.', 'Screen sharing works.'], 'Corrected the Teams meeting policy.', 'other'],
  ],
  'Meeting room AV fault': [
    ['Boardroom screen not showing laptop', 'The boardroom display shows "no signal" when we connect with HDMI. Board meeting at 2pm.', ['Engineer dispatched as urgent.', 'HDMI extender power supply failed.', 'Replaced the power supply, tested with two laptops before the meeting.'], 'Replaced the HDMI extender power supply.', 'hardware repair'],
  ],
  'Cannot open shared files': [
    ['Access denied on the projects drive', 'I get "access denied" on P:\\Projects\\2026 since this morning.', ['User was removed from the project group by the quarterly access review.', 'Line manager approved access again.', 'Access restored.'], 'Re-added the user to the project group after manager approval.', 'assistance'],
  ],
  'Account locked out': [
    ['Account locked out repeatedly', 'My account keeps locking every 20 minutes. I have not typed a wrong password.', ['Lockout source: an old phone still syncing email with the previous password.', 'Removed the old device partnership and asked the user to update the phone.', 'No further lockouts.'], 'Removed the stale device causing lockouts.', 'assistance'],
    ['Locked out of my account after holiday', 'I came back from leave and cannot sign in, it says my account is locked.', ['Verified the caller identity with the employee number and manager.', 'Unlocked the account and sent a temporary password by SMS.', 'User signed in and changed the password.'], 'Unlocked the account after identity check.', 'assistance'],
  ],
  'VPN cannot connect': [
    ['VPN connects then drops after one minute', 'FortiClient connects but disconnects after about a minute. I am working from home.', ['Home router blocks the default VPN port.', 'Switched the user profile to SSL VPN on 443.', 'Stable for a full working day.'], 'Moved the user to the SSL VPN profile.', 'other'],
    ['VPN error "credential or SSL VPN configuration is wrong"', 'Since this morning the VPN shows a credential error, but my password works for email.', ['User was not in the VPN group after the department move.', 'Added to the correct VPN group with manager approval.', 'Connected successfully.'], 'Corrected the VPN group membership.', 'assistance'],
  ],
  'MFA prompt not received': [
    ['Not getting the Authenticator notification', 'I changed my phone and now I never get the approval prompt to sign in.', ['Old device still registered as the default method.', 'Reset MFA methods after verifying identity; user registered the new phone.', 'Sign-in works.'], 'Re-registered MFA on the new phone.', 'assistance'],
  ],
  'No network connection': [
    ['Whole floor lost network at {site}', 'Nobody on {floor} has network or internet. Wi-Fi works on phones.', ['Access switch on {floor} unreachable from the monitoring system.', 'Engineer on site: switch power supply failed. Moved the switch to the redundant feed.', 'All ports up, users confirmed.'], 'Restored the switch power; replacement PSU ordered.', 'hardware repair'],
    ['Desk network port not working', 'The network socket at my desk does not work, my laptop says "unidentified network".', ['Port was administratively disabled after the office move.', 'Enabled and assigned the port to the staff VLAN.', 'User connected.'], 'Enabled the switch port on the staff VLAN.', 'other'],
  ],
  'Slow network': [
    ['Internet very slow at {site}', 'Pages take ages to load and Teams video freezes for everyone at our office.', ['Primary link saturated by an unscheduled backup copy to the cloud.', 'Throttled the backup job to after hours and applied QoS for Teams.', 'Utilisation back to normal.'], 'Rescheduled the backup traffic and applied QoS.', 'other'],
  ],
  'Wi-Fi drops or no signal': [
    ['Wi-Fi keeps disconnecting in the meeting rooms', 'In meeting rooms 3 and 4 the Wi-Fi drops every few minutes.', ['One access point rebooting in a loop.', 'Replaced the access point under support contract.', 'Survey shows full coverage.'], 'Replaced the faulty access point.', 'hardware repair'],
    ['Guests cannot connect to Wi-Fi in the lobby', 'Hotel guests in the lobby report the Wi-Fi login page does not load.', ['Captive portal certificate expired.', 'Renewed the certificate on the guest portal.', 'Guests connecting again.'], 'Renewed the guest portal certificate.', 'system update'],
  ],
  'Site internet outage': [
    ['Internet down at {site}', 'We have no internet at all at {site}. Card payments are also affected.', ['Primary ISP link down; SD-WAN failed over to the 5G backup.', 'Logged a fault with the ISP: fibre cut nearby.', 'Primary link restored by the ISP, traffic back on fibre.'], 'ISP repaired the fibre; failover worked as designed.', 'other'],
  ],
  'Server down or unresponsive': [
    ['File server not responding', 'Nobody can open the shared drives since 8:30.', ['VM stuck after a failed snapshot consolidation.', 'Consolidated the snapshot and restarted the VM.', 'Shares available, root cause recorded.'], 'Fixed the stuck snapshot and restarted the server.', 'other'],
  ],
  'Disk space alert': [
    ['Low disk space on database server', 'Monitoring: data volume at 92% on the SQL server.', ['Transaction log not truncating because the log backup job was disabled.', 'Re-enabled log backups and shrank the log after the backup.', 'Volume at 61%.'], 'Re-enabled transaction log backups.', 'other'],
  ],
  'Backup job failed': [
    ['Nightly backup failed for 2 servers', 'Backup report: jobs for two servers failed with "VSS error".', ['VSS writer stuck on both servers after patching.', 'Restarted the services and ran the jobs manually.', 'Both backups completed.'], 'Restarted VSS writers and re-ran the backups.', 'other'],
  ],
  'Cloud service degraded': [
    ['Customer portal slow (Azure)', 'Our customer portal is taking 20+ seconds to load.', ['App Service plan CPU at 100% after a marketing campaign.', 'Scaled out to 3 instances and enabled autoscale.', 'Response times under 2 seconds.'], 'Scaled out the App Service and enabled autoscale.', 'other'],
  ],
  'ERP error or slowness': [
    ['ERP posting error "number sequence exhausted"', 'We cannot post vendor invoices in Dynamics, it says the number sequence is exhausted.', ['Invoice journal number sequence reached its maximum.', 'Extended the number sequence with the finance controller approval.', 'Posting works.'], 'Extended the ERP number sequence.', 'other'],
    ['Dynamics 365 very slow during month-end', 'Running reports and posting in Dynamics is extremely slow today.', ['Batch jobs for month-end running in business hours.', 'Moved the heavy batch jobs to the evening batch group.', 'Users report normal speed.'], 'Rescheduled heavy batch jobs.', 'other'],
  ],
  'CRM issue': [
    ['Salesforce leads not assigning to agents', 'New leads from the website stay unassigned since yesterday.', ['Assignment rule deactivated during a release.', 'Reactivated the rule and reassigned the backlog.', 'New leads assigned automatically.'], 'Reactivated the lead assignment rule.', 'other'],
  ],
  'POS terminal fault': [
    ['POS till 3 frozen at {site}', 'Till 3 is stuck on the payment screen and will not respond. Queue building up.', ['Remote restart of the POS client failed.', 'Store staff power-cycled the till as instructed.', 'Till back in service, transaction log checked.'], 'Power-cycled the terminal; transactions reconciled.', 'assistance'],
    ['Card payments declined on all tills', 'All card payments fail with "host unreachable".', ['Payment gateway certificate expired on the POS server.', 'Installed the new certificate from the acquirer.', 'Card payments working, no transactions lost.'], 'Renewed the payment gateway certificate.', 'system update'],
  ],
  'HIS module error': [
    ['Cannot print patient labels from HIS', 'The patient label printer gives an error from the registration screen.', ['Label printer mapping lost after the HIS client update.', 'Re-mapped the printer in the HIS client settings.', 'Labels printing.'], 'Re-mapped the HIS label printer.', 'assistance'],
    ['Lab results not appearing in patient record', 'Results from the lab analyser are not showing in the HIS since this morning.', ['Interface engine queue stopped.', 'Restarted the HL7 interface and replayed 42 queued messages.', 'Results visible to doctors.'], 'Restarted the HL7 interface and replayed the queue.', 'other'],
  ],
  'PMS or key card issue': [
    ['Key cards not encoding at front desk', 'The key encoder at reception does not write the room cards.', ['Encoder lost connection to the lock server.', 'Restarted the lock interface service.', 'Cards encoding again.'], 'Restarted the lock interface.', 'assistance'],
  ],
  'Malware alert': [
    ['Antivirus alert: suspicious file quarantined', 'Defender alert on {device}: trojan detected in Downloads.', ['File quarantined automatically; device isolated for investigation.', 'Full scan clean; file came from a fake invoice email.', 'Device released, user briefed.'], 'Quarantined, scanned clean, user briefed.', 'other'],
  ],
  'Phishing email reported': [
    ['Suspicious email asking to update bank details', 'I received an email from a supplier asking us to change their bank account. It looks strange.', ['Email confirmed as phishing (lookalike domain).', 'Purged the message from 37 mailboxes and blocked the domain.', 'Finance team informed; no payment made.'], 'Purged the phishing email and blocked the sender domain.', 'other'],
  ],
};

/** Request stories, per subcategory: [title, description, conversation, fix]. */
export const REQUESTS = {
  'New laptop or desktop': [['New laptop for {person}', 'Please prepare a standard laptop for {person}, joining on Sunday as {role}.', ['Laptop imaged and enrolled in Intune.', 'Delivered to {site} and handed over with the user.'], 'Laptop delivered and set up.']],
  'Hardware upgrade': [['Second monitor for {person}', 'Please provide a second 24-inch monitor for {person}.', ['Monitor issued from stock.', 'Installed at the desk.'], 'Monitor installed.']],
  'Add a printer': [['Add the {floor} printer to my laptop', 'Please add the printer on {floor} to my laptop.', ['Pushed the printer through Intune.'], 'Printer added.']],
  'New mobile device': [['Company mobile phone for {person}', 'Approved by the line manager: company phone for {person} ({role}).', ['Phone enrolled in Intune with the standard apps.', 'Collected by the user from {site}.'], 'Phone issued.']],
  'Mobile email setup': [['Set up work email on my new phone', 'I have a new personal phone and need my work email on it.', ['Sent the Company Portal enrolment guide.', 'Enrolled and verified mail sync.'], 'Email set up via Company Portal.']],
  'Install software': [['Install Microsoft Visio for {person}', 'Please install Visio for {person} for process mapping work.', ['Licence assigned from the pool.', 'Installed through the company portal.'], 'Visio installed.'], ['Install Power BI Desktop', 'I need Power BI Desktop to build the monthly sales dashboard.', ['Published to the user from Software Center.'], 'Installed.']],
  'Software licence request': [['Adobe Acrobat Pro licence for {person}', 'Requesting an Acrobat Pro licence to edit and sign contracts.', ['Licence approved by the department head.', 'Assigned and activated.'], 'Licence assigned.']],
  'Shared mailbox or distribution list': [['New shared mailbox for the procurement team', 'Please create procurement@ shared mailbox with access for 5 team members.', ['Shared mailbox created, access granted.', 'Appears in Outlook for all members.'], 'Shared mailbox created.']],
  'Mailbox size increase': [['Mailbox full - increase size', 'My mailbox is almost full and I get warnings every day.', ['Enabled online archiving with a 2-year policy.'], 'Online archive enabled.']],
  'New Teams team or channel': [['New Teams team for the {app} project', 'Please create a Teams team for the {app} project with the members listed.', ['Team created with the project template.'], 'Team created.']],
  'Access to a shared folder': [['Access to the HR shared folder for {person}', 'Please give {person} read and write access to the HR folder. Approved by the HR manager.', ['Added to the HR folder group.'], 'Access granted.']],
  'Restore a deleted file': [['Restore a deleted Excel file', 'I deleted the budget file from the finance share yesterday by mistake.', ['Restored the file from last night\'s snapshot.'], 'File restored.']],
  'Password reset': [['Password reset for {person}', 'User forgot the password after leave.', ['Identity verified, temporary password sent by SMS.'], 'Password reset.']],
  'New starter account': [['New joiner: {person}, {role}', 'New employee {person} joins as {role}. Please create email, ERP and VPN access.', ['Account and mailbox created.', 'Added to department groups and the VPN group.', 'Credentials handed to the line manager.'], 'Accounts created.']],
  'Leaver account removal': [['Leaver: disable accounts for {person}', '{person} leaves on Thursday. Please disable access at end of day and forward email to the manager.', ['Scheduled disable for 18:00.', 'Mail forwarded to the manager, device collected.'], 'Accounts disabled.']],
  'VPN access request': [['VPN access for {person}', '{person} needs VPN access for working from home. Approved by the manager.', ['Added to the VPN group, FortiClient installed.'], 'VPN access granted.']],
  'Register a new phone for MFA': [['Register new phone for MFA', 'I lost my phone and need to set up the Authenticator on the new one.', ['Identity verified; MFA methods reset.', 'User registered the new phone.'], 'MFA re-registered.']],
  'New network point': [['New network point for the {floor} reception desk', 'Please activate two network points for the new reception desk on {floor}.', ['Patched and enabled both points.'], 'Network points live.']],
  'Guest Wi-Fi access': [['Guest Wi-Fi for visiting auditors', 'External auditors (4 people) need Wi-Fi for two weeks.', ['Created sponsored guest accounts valid for 14 days.'], 'Guest access created.']],
  'Firewall rule change': [['Allow the new SFTP partner connection', 'Please allow our partner to reach the SFTP server from their public IP.', ['Change raised and approved.', 'Rule added and tested with the partner.'], 'Rule implemented.']],
  'New virtual machine': [['New VM for the reporting server', 'Please build a Windows Server VM (4 vCPU, 16 GB) for the new reporting tool.', ['VM built from the hardened template.', 'Joined to the domain, backups configured.'], 'VM delivered.']],
  'Restore request': [['Restore last week\'s version of the contracts folder', 'Please restore the contracts folder as it was on Monday.', ['Restored to an alternate location for review.'], 'Restored to an alternate location.']],
  'Cloud resource request': [['Azure storage account for document archive', 'We need storage for the scanned document archive (about 2 TB).', ['Storage account created with lifecycle rules to the cool tier.'], 'Storage account created.']],
  'ERP user access': [['Dynamics 365 access for {person}', 'Please grant {person} the Accounts Payable clerk role in Dynamics.', ['Role assigned after finance controller approval.'], 'Access granted.']],
  'ERP report request': [['Monthly ageing report by region', 'Can we have the receivables ageing report split by region?', ['Report built and published to the finance workspace.'], 'Report delivered.']],
  'CRM user or role change': [['Salesforce licence for {person}', 'New sales consultant {person} needs a Salesforce licence.', ['Licence assigned with the sales profile.'], 'User created.']],
  'New POS terminal': [['Additional POS terminal for {site}', 'We need a 4th till for the weekend peak at {site}.', ['Terminal configured and shipped.', 'Installed and test transaction done.'], 'Terminal installed.']],
  'HIS user access': [['HIS access for new nurse {person}', 'Please create HIS access for {person}, staff nurse.', ['Account created with the nursing role after training sign-off.'], 'Access granted.']],
  'PMS user access': [['Opera access for {person}', 'New front office agent {person} needs Opera access.', ['User created with the front desk role.'], 'Access granted.']],
  'Antivirus exclusion': [['Antivirus exclusion for the lab analyser folder', 'Defender slows the analyser export folder; please add an exclusion.', ['Security reviewed and approved a scoped exclusion.'], 'Exclusion applied.']],
  'Release quarantined email': [['Release quarantined supplier invoice', 'An invoice email from our supplier is in quarantine.', ['Checked headers and attachment: safe. Released.'], 'Email released.']],
};

/** Problems: [title, description, root cause, workaround, solution, related subcategory]. */
export const PROBLEMS = [
  ['Recurring Wi-Fi driver crashes on Latitude 5440 laptops', 'Blue screens on Latitude 5440 laptops traced to the Intel Wi-Fi driver.', 'Intel AX211 driver 23.10 has a known memory leak during roaming.', 'Roll back to driver 23.5 on affected laptops.', 'Driver 23.20 validated and deployed to all laptops through Intune.', 'Hardware fault'],
  ['Account lockouts after password changes', 'Many lockouts follow password changes, caused by old devices still syncing.', 'Stale ActiveSync partnerships on old phones keep sending the old password.', 'Remove old device partnerships on request.', 'Automatic cleanup of devices inactive for 30 days.', 'Account locked out'],
  ['Print queues stop after monthly patching', 'Print spoolers stop on print servers after the monthly reboot.', 'A third-party print driver is not compatible with the latest cumulative update.', 'Restart the spooler after patching.', 'Replaced the driver with the universal print driver.', 'Printer not working'],
  ['Guest Wi-Fi portal certificate expiries', 'Guest portals become unreachable when their certificate expires.', 'Certificates renewed manually with no reminder.', 'Renew manually on expiry.', 'Moved to automatic certificate renewal with monitoring.', 'Wi-Fi drops or no signal'],
  ['ERP slowness during month-end', 'Dynamics 365 very slow during month-end closing.', 'Heavy batch jobs scheduled in business hours compete with users.', 'Ask users to avoid large reports at month-end.', 'New batch schedule and a dedicated batch group.', 'ERP error or slowness'],
  ['VSS errors after patching break backups', 'Backups fail on several servers after patch nights.', 'VSS writers left in a failed state by an agent update.', 'Restart services and re-run jobs.', 'Agent upgraded; post-patch health check added.', 'Backup job failed'],
  ['Teams audio quality complaints on older headsets', 'Many calls with choppy audio from users on non-certified headsets.', 'Older USB headsets drop packets with the new Teams client.', 'Replace headsets on request.', 'Headset refresh for all affected users.', 'Teams call or meeting problem'],
  ['Payment gateway certificate expiries on POS', 'Card payments fail when the gateway certificate expires.', 'No inventory of certificates on POS servers.', 'Manual renewal by the applications team.', 'Certificate inventory with 30-day alerts.', 'POS terminal fault'],
  ['HL7 interface stops after HIS restarts', 'Lab results stop flowing after HIS maintenance.', 'Interface engine does not reconnect automatically.', 'Restart the interface after maintenance.', 'Enabled auto-reconnect and a queue-depth alert.', 'HIS module error'],
  ['Switch power supply failures at older sites', 'Several access switches lost power in the same quarter.', 'Switches past end of life with ageing power supplies.', 'Use the redundant feed.', 'Switch refresh planned for the affected sites.', 'No network connection'],
];

/** Changes: [title, description, reason, implementation plan, fallback, outage, kind]. */
export const CHANGES = [
  ['Monthly Windows security patching - {client}', 'Deploy the monthly Microsoft security updates to servers and workstations.', 'Security compliance', 'Pilot ring Tuesday, broad ring Thursday, servers in the Saturday window.', 'Uninstall the update through WSUS if a critical issue is found.', 'no', 'RoutineChange'],
  ['FortiGate firmware upgrade - {site}', 'Upgrade the firewall firmware to the latest recommended release.', 'Vendor security advisory', 'Back up config, upgrade passive unit, fail over, upgrade active unit.', 'Downgrade and restore the saved configuration.', 'yes', 'NormalChange'],
  ['Migrate file shares to SharePoint - {client}', 'Move departmental file shares to SharePoint Online.', 'Retire the on-premises file server', 'Migrate in waves per department over weekends.', 'Keep the file server read-only until sign-off.', 'no', 'NormalChange'],
  ['Replace core switch - {site}', 'Replace the end-of-life core switch with a Catalyst 9300 stack.', 'End of support of the current switch', 'Pre-stage config, swap during the Friday window, test all VLANs.', 'Reconnect the old switch.', 'yes', 'NormalChange'],
  ['Dynamics 365 release update - {client}', 'Apply the Dynamics 365 service update.', 'Vendor release cycle', 'Test in UAT, apply to production on Saturday night.', 'Restore the database snapshot.', 'yes', 'NormalChange'],
  ['Add disk to SQL server data volume - {client}', 'Extend the SQL data volume by 200 GB.', 'Capacity', 'Extend the virtual disk and the volume online.', 'None needed: online operation.', 'no', 'RoutineChange'],
  ['Emergency patch for VPN vulnerability', 'Apply the vendor hotfix for the actively exploited SSL VPN vulnerability.', 'Critical security vulnerability', 'Apply the hotfix tonight on all FortiGate units.', 'Disable SSL VPN and use IPsec until fixed.', 'yes', 'EmergencyChange'],
  ['Enable MFA for all remote access - {client}', 'Require MFA for VPN and webmail.', 'Security policy', 'Pilot group first, then all staff with two weeks notice.', 'Exclude affected users temporarily.', 'no', 'NormalChange'],
  ['New Wi-Fi access points - {site}', 'Install 6 additional access points to fix coverage gaps.', 'Coverage complaints', 'Install after hours, adopt in Meraki dashboard.', 'Remove the new access points.', 'no', 'NormalChange'],
  ['Backup retention policy change - {client}', 'Extend backup retention from 14 to 30 days.', 'Audit requirement', 'Update the policies and verify the next jobs.', 'Revert to the previous policy.', 'no', 'RoutineChange'],
  ['Renew wildcard SSL certificate - {client}', 'Replace the expiring wildcard certificate on all web services.', 'Certificate expiry', 'Install on load balancer and portals, test each site.', 'Reinstall the old certificate (valid 10 more days).', 'no', 'RoutineChange'],
  ['Emergency restore of the customer portal', 'Roll back the customer portal after a failed release caused errors for all users.', 'Service outage', 'Swap deployment slots back to the previous release.', 'None: rollback is the fallback.', 'yes', 'EmergencyChange'],
];

/** Knowledge articles: [category, title, summary, body]. */
export const FAQS = [
  ['Accounts & Passwords', 'How to reset your password with self-service', 'Reset your own password from the sign-in page in two minutes.', 'Go to the sign-in page and choose "Forgot password". Confirm with your registered phone or email, then choose a new password of at least 12 characters with upper and lower case, a number and a symbol. Update the password on your phone\'s email app afterwards to avoid lockouts.'],
  ['Accounts & Passwords', 'Why does my account keep locking?', 'The usual cause is an old device still using your previous password.', 'After a password change, every device that signs in with your account must be updated: phones, tablets, mapped drives and saved Wi-Fi profiles. If you still get locked out, raise a request and we will find the device for you.'],
  ['Accounts & Passwords', 'Setting up Microsoft Authenticator on a new phone', 'Move your MFA to a new phone without getting locked out.', 'Before you reset your old phone, open My Sign-ins and add the new phone. If the old phone is lost, call the Service Desk: we verify your identity and reset your methods.'],
  ['Remote Working', 'Connecting to the VPN from home', 'Install FortiClient and connect with your work account.', 'Install FortiClient from the company portal. Choose the profile for your company, sign in with your work email and approve the MFA prompt. If the connection drops after a minute, choose the SSL profile (port 443).'],
  ['Remote Working', 'Working from a hotel or airport Wi-Fi', 'How to stay secure on public Wi-Fi.', 'Always connect the VPN before opening company applications. Avoid printing or saving files to USB drives. Report a lost device to the Service Desk immediately so it can be wiped.'],
  ['Email & Calendar', 'Outlook keeps asking for my password', 'Clear the saved credentials and restart Outlook.', 'Close Outlook, open Credential Manager, remove entries starting with "MicrosoftOffice" and restart Outlook. If prompts continue, the Service Desk can rebuild your profile.'],
  ['Email & Calendar', 'How to share your calendar', 'Give colleagues view or edit access to your calendar.', 'In Outlook, right-click your calendar, choose Sharing Permissions, add the colleague and choose the level of access. Delegates can accept meetings on your behalf.'],
  ['Email & Calendar', 'Recognising phishing emails', 'Five signs that an email is a scam.', 'Check the sender address, not just the name. Be suspicious of urgency, payment or bank detail changes, unexpected attachments and links that do not match the company. Use the Report button in Outlook: never forward phishing to colleagues.'],
  ['Printing', 'Adding a printer to your laptop', 'Add an office printer from the company portal.', 'Open the company portal, search for your office and floor, and click Install. Printers follow you: the nearest printer on each site is offered automatically.'],
  ['Printing', 'Secure print: releasing your print job', 'Print jobs wait until you tap your badge.', 'Send your document to "Secure Print". At any printer, tap your access badge and choose the jobs to release. Jobs not released within 24 hours are deleted.'],
  ['Teams & Meetings', 'Joining a Teams meeting from a meeting room', 'Use the room panel to join with one touch.', 'Meeting rooms with a Teams panel show today\'s meetings. Tap Join. To share your laptop, use the HDMI cable or "Cast" from Teams.'],
  ['Teams & Meetings', 'Improving Teams call quality at home', 'Simple steps for clearer calls.', 'Use a certified headset, connect by cable when possible, close video when the connection is weak and keep your Teams client updated.'],
  ['Devices', 'Requesting a new laptop or monitor', 'What you can request and how long it takes.', 'Raise a request in the portal under Laptops & Desktops. Standard laptops are delivered in 3 working days; engineering workstations in 10. Line manager approval is needed.'],
  ['Devices', 'Returning equipment when you leave', 'Hand back your devices on your last day.', 'Your manager raises the leaver request. On your last day, return your laptop, phone and badge to the IT desk or the field engineer. Personal data should be removed beforehand.'],
  ['Business Applications', 'Requesting access to Dynamics 365', 'Access to ERP roles needs your manager and the finance controller.', 'Raise an ERP user access request naming the role you need. The request goes to your manager and then the finance controller for approval.'],
  ['Business Applications', 'POS: what to do when a till freezes', 'Quick steps for store staff.', 'Wait 30 seconds, then hold the power button for 10 seconds and switch it back on. If the till still does not respond, call the Service Desk with the store name and till number.'],
  ['Security', 'What to do if you clicked a suspicious link', 'Act fast: report it and change your password.', 'Disconnect from the network, call the Service Desk and change your password from another device. Do not be embarrassed: reporting quickly limits the damage.'],
  ['Security', 'Using USB drives', 'Company policy on removable storage.', 'USB storage is read-only on company devices. Use OneDrive or SharePoint to share files. Exceptions need Security Operations approval.'],
];

/** Calendar of UAE public holidays 2026 (approximate lunar dates). */
export const HOLIDAYS = [
  ['New Year\'s Day', '2026-01-01'],
  ['Eid Al Fitr', '2026-03-20'],
  ['Eid Al Fitr holiday', '2026-03-21'],
  ['Eid Al Fitr holiday', '2026-03-22'],
  ['Arafat Day', '2026-05-26'],
  ['Eid Al Adha', '2026-05-27'],
  ['Eid Al Adha holiday', '2026-05-28'],
  ['Islamic New Year', '2026-06-16'],
  ['Prophet\'s Birthday', '2026-08-25'],
  ['Commemoration Day', '2026-12-01'],
  ['National Day', '2026-12-02'],
  ['National Day holiday', '2026-12-03'],
];

/** Service levels per contract tier: tto/ttr in hours per priority [1..4]. */
export const TIERS = {
  Platinum: { tto: [0.25, 0.5, 1, 4], ttr: [4, 8, 24, 72], window: '24x7' },
  Gold: { tto: [0.5, 1, 2, 8], ttr: [4, 12, 32, 80], window: 'business' },
  Silver: { tto: [1, 2, 4, 8], ttr: [8, 24, 48, 120], window: 'business' },
};

/** Which tier each client buys. */
export const CLIENT_TIER = { QAB: 'Platinum', WCL: 'Gold', MBM: 'Platinum', SRH: 'Gold', FEC: 'Silver', PHP: 'Silver', DHS: 'Silver', SVS: 'Silver', CCF: 'Platinum', LCP: 'Gold' };

/** Supplier contracts IRAOPS holds: [name, provider, services, yearly cost USD]. */
export const PROVIDER_CONTRACTS = [
  ['Dell ProSupport Plus - laptops and servers', 'Dell Technologies', 42000],
  ['Microsoft 365 E3 - CSP subscriptions', 'Microsoft', 186000],
  ['Cisco SmartNet - switching and wireless', 'Cisco Systems', 28000],
  ['FortiCare 24x7 - firewalls', 'Fortinet', 19500],
  ['Veeam Data Platform - backup licences', 'Veeam Software', 16800],
  ['Etisalat business fibre and 5G backup', 'e& (Etisalat)', 64000],
];

/** Reports (saved queries): [name, description, OQL, columns]. */
export const REPORTS = [
  ['Open incidents by client and priority', 'Every open incident with its client, priority, team and assignee.', "SELECT Incident WHERE status NOT IN ('resolved','closed')", 'ref,title,org_name,priority,status,team_name,agent_name,start_date'],
  ['Major incidents - last 90 days', 'Major incidents raised in the last 90 days, with resolution.', "SELECT Incident WHERE major_incident = 'yes' AND start_date > DATE_SUB(NOW(), INTERVAL 90 DAY)", 'ref,title,org_name,priority,status,start_date,resolution_date,solution'],
  ['SLA breaches - resolution time (last 30 days)', 'Incidents whose resolution target was missed in the last 30 days.', "SELECT Incident WHERE sla_ttr_passed = 1 AND start_date > DATE_SUB(NOW(), INTERVAL 30 DAY)", 'ref,title,org_name,priority,team_name,agent_name,start_date,resolution_date'],
  ['SLA breaches - response time (last 30 days)', 'Incidents and requests not picked up within the response target.', "SELECT Incident WHERE sla_tto_passed = 1 AND start_date > DATE_SUB(NOW(), INTERVAL 30 DAY)", 'ref,title,org_name,priority,team_name,start_date,assignment_date'],
  ['Requests resolved this month', 'Service requests resolved since the 1st of the month.', "SELECT UserRequest WHERE resolution_date >= DATE_FORMAT(NOW(), '%Y-%m-01')", 'ref,title,org_name,servicesubcategory_name,agent_name,start_date,resolution_date'],
  ['Customer satisfaction - last 90 days', 'Closed tickets with the satisfaction rating and comment given by the caller.', "SELECT UserRequest WHERE status = 'closed' AND close_date > DATE_SUB(NOW(), INTERVAL 90 DAY)", 'ref,title,org_name,agent_name,user_satisfaction,user_comment,close_date'],
  ['Backlog by team', 'Open incidents and requests per team and status.', "SELECT Ticket WHERE operational_status = 'ongoing'", 'ref,title,org_name,team_name,agent_name,start_date,last_update'],
  ['Changes scheduled - next 30 days', 'Planned changes with their window and outage.', "SELECT Change WHERE start_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)", 'ref,title,org_name,status,start_date,end_date,outage,team_name'],
  ['Changes implemented - last 90 days', 'Changes implemented or closed in the last 90 days.', "SELECT Change WHERE status IN ('implemented','monitored','closed') AND start_date > DATE_SUB(NOW(), INTERVAL 90 DAY)", 'ref,title,org_name,status,start_date,end_date,team_name'],
  ['Open problems and known errors', 'Problems under investigation with their root cause and workaround.', "SELECT Problem WHERE status != 'closed'", 'ref,title,status,priority,agent_name,start_date,root_cause,workaround'],
  ['Laptops and desktops by client', 'End-user devices with model, operating system, warranty and status.', 'SELECT PC', 'name,org_name,type,brand_name,model_name,osversion_name,location_name,end_of_warranty,status'],
  ['Hardware warranty ending in 90 days', 'Devices whose warranty ends within 90 days.', "SELECT PhysicalDevice WHERE end_of_warranty BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 90 DAY)", 'name,org_name,brand_name,model_name,end_of_warranty,location_name'],
  ['Servers and network devices', 'Infrastructure per client with location and criticality.', "SELECT FunctionalCI WHERE finalclass IN ('Server','NetworkDevice')", 'name,finalclass,org_name,business_criticity'],
  ['Contracts and service levels', 'Client contracts with their dates and value.', 'SELECT CustomerContract', 'name,org_name,start_date,end_date,cost,cost_unit,status'],
  ['Staff directory', 'Everyone at each client and at IRAOPS, with function and office.', 'SELECT Person', 'first_name,name,org_name,function,email,phone,location_name'],
];
