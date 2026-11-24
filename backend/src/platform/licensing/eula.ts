/**
 * The agreements a customer accepts (LIC-17): the end-user licence agreement
 * for a deployed installation, and the terms of service for the hosted
 * service (SaaS).
 *
 * INTERIM TEXT, written on 2026-11-19 so that customers accept a real
 * agreement from the first day. Intertec Legal is preparing the final
 * agreements (LEG-01, LEG-02). When they arrive, replace the text here and
 * give it a NEW version: every tenant and installation is then asked to
 * accept again (an acceptance counts only for the version it was given for).
 */

export interface Agreement {
  /** Recorded with each acceptance. A new text needs a new version. */
  version: string;
  title: string;
  text: string;
}

const EULA: Agreement = {
  version: "eula-2026-11-19",
  title: "End-user licence agreement",
  text: `ARCUS END-USER LICENCE AGREEMENT
Version eula-2026-11-19

This End-User Licence Agreement (the “Agreement”) is between the Intertec company named in your order (“Intertec”, “we”, “us”) and the organisation that ordered the software (the “Customer”, “you”). It applies to the Arcus service management software, its updates, and its documentation (together, the “Software”) when you install and run it in your own environment.

By selecting “I accept”, installing a licence key or using the Software, you confirm that you have read this Agreement, that you accept it on behalf of the Customer, and that you are authorised to do so. If you do not accept it, do not install or use the Software.

1. DEFINITIONS
1.1 “Order” means the quotation, order form or contract between you and Intertec (or an authorised Intertec partner) that lists the edition, number of agents, add-ons, term and fees.
1.2 “Licence Key” means the signed licence file Intertec issues for your Order. It sets the edition, limits, term and the installation it is bound to.
1.3 “Agent” means a named user account that holds an agent or other staff profile. Requesters and portal users who only raise and follow their own requests are not Agents.
1.4 “Customer Data” means all data you or your users put into the Software.
1.5 “Documentation” means the user, administration and installation guides Intertec makes available for the Software.

2. LICENCE
2.1 Subject to this Agreement and payment of the fees, Intertec grants you a non-exclusive, non-transferable, non-sublicensable licence, for the term in your Licence Key, to install and use the Software for your internal business purposes, within the edition, limits and installations in your Licence Key.
2.2 You may make a reasonable number of copies for backup, disaster recovery and non-production testing, as allowed by your Licence Key.
2.3 Your affiliates, employees and contractors may use the Software on your behalf. You are responsible for their use as if it were your own.

3. RESTRICTIONS
You must not, and must not allow anyone else to:
(a) use the Software beyond the edition, number of Agents, limits, term or installations in your Licence Key;
(b) copy, modify or create derivative works of the Software, except as this Agreement allows or the law expressly permits;
(c) reverse engineer, decompile or disassemble the Software, except to the extent the law expressly permits despite this restriction;
(d) remove, bypass or interfere with the Licence Key, its checks, or any notices in the Software;
(e) sell, rent, lease, lend, sublicense or provide the Software to third parties as a service, unless your Order expressly allows it;
(f) use the Software to break the law or the rights of others.

4. LICENCE KEYS, LIMITS AND USAGE
4.1 The Software checks the Licence Key. Features outside your edition are not available, and when a limit is reached the Software warns you, allows up to 10% more, and then pauses new use of that kind until the limit is raised. Existing data is never deleted because of a limit.
4.2 The Software records usage (for example, the number of Agents and configuration items) so that you can see it against your entitlement. You may be asked to provide a signed usage report, produced by the Software, no more than once a year, or when renewing or changing your Order.
4.3 If your use exceeds your entitlement, you agree to order the additional entitlement at Intertec’s then-current prices from the date the excess began.

5. TERM, RENEWAL AND EXPIRY
5.1 This Agreement starts when you first accept it or install a Licence Key, and continues for the term of your Licence Key and any renewals.
5.2 A subscription licence ends on the end date in the Licence Key unless renewed. After it ends there is a grace period (normally 30 days) in which the Software keeps working and shows a notice. After the grace period, the Software becomes read-only: your users can still read and export all Customer Data, but cannot make changes, until a new Licence Key is installed.
5.3 A perpetual licence does not expire. Maintenance (updates and support) runs until the date in the Licence Key; releases made after that date cannot be installed with that licence unless maintenance is renewed.
5.4 An evaluation licence is for evaluation only, not for production use, and ends on its end date without a grace period.

6. MAINTENANCE AND SUPPORT
While you have an active subscription or maintenance, Intertec provides updates and support as described in your Order and Intertec’s support terms. You are responsible for installing updates in your environment, for the infrastructure the Software runs on, and for backing up your Customer Data.

7. FEES AND TAXES
You will pay the fees in your Order, on the terms in your Order. Fees exclude taxes (including VAT). You will pay all applicable taxes except taxes on Intertec’s income. Fees are non-refundable except as this Agreement or your Order expressly states.

8. CUSTOMER DATA AND PRIVACY
8.1 You own your Customer Data. Intertec acquires no rights in it.
8.2 The Software runs in your environment and does not send Customer Data to Intertec. If you share Customer Data with Intertec (for example, to obtain support), Intertec will use it only to provide that support, keep it confidential and protect it with appropriate security measures, in line with applicable data protection law, including the UAE Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data.
8.3 Optional features that use external services (for example, AI assistance or email providers) send data to those services only if you switch them on and configure them. You are responsible for your choice of such services.

9. INTELLECTUAL PROPERTY
9.1 The Software is licensed, not sold. Intertec and its licensors own all rights in the Software and Documentation. All rights not expressly granted to you are reserved.
9.2 The Software includes open-source components, each licensed under its own terms, which apply to that component and are available on request. Nothing in this Agreement limits your rights under those licences.
9.3 If you send Intertec suggestions or feedback, Intertec may use them without obligation to you.

10. CONFIDENTIALITY
Each party will keep the other’s confidential information confidential, use it only for this Agreement, and protect it with at least reasonable care. This does not apply to information that is public through no fault of the receiving party, already known to it, independently developed, or lawfully received from a third party. A party may disclose confidential information when required by law, after giving notice where lawful. The Software, its Documentation and pricing are Intertec’s confidential information; Customer Data is yours.

11. WARRANTY
11.1 Intertec warrants that, for 90 days from first delivery of a release, the Software will perform materially as described in its Documentation. If it does not, and you tell us during that period, Intertec will, at its option, fix the Software, replace it, or refund the fees paid for the non-conforming part. This is your only remedy for breach of this warranty.
11.2 The warranty does not cover problems caused by misuse, unsupported environments, changes not made by Intertec, or third-party products.
11.3 Except as stated in this section, and to the extent the law allows, the Software is provided “as is”, and Intertec disclaims all other warranties, express or implied, including fitness for a particular purpose, merchantability and non-infringement.

12. INTELLECTUAL PROPERTY INDEMNITY
12.1 Intertec will defend you against any third-party claim that the Software, as delivered by Intertec and used in line with this Agreement, infringes that third party’s intellectual property rights, and will pay the damages and costs finally awarded or agreed in settlement.
12.2 You must tell Intertec promptly about the claim, let Intertec control the defence and settlement, and give reasonable help. If the Software is, or may be, found to infringe, Intertec may obtain the right for you to continue using it, change it so it no longer infringes, or end the licence and refund the unused prepaid fees.
12.3 This indemnity does not apply to claims caused by your changes, your combination of the Software with items not supplied by Intertec, or use beyond this Agreement. This section states Intertec’s entire liability for infringement claims.

13. LIMITATION OF LIABILITY
13.1 Neither party is liable for any indirect, incidental, special or consequential loss, or for loss of profit, revenue, business, goodwill or data, however caused, even if advised of the possibility.
13.2 Each party’s total liability arising out of or relating to this Agreement is limited to the fees paid and payable by you to Intertec under the Order in the 12 months before the event giving rise to the claim.
13.3 Sections 13.1 and 13.2 do not limit liability for fraud, for death or personal injury caused by negligence, for breach of confidentiality, for your obligation to pay fees, for your breach of section 3, for Intertec’s obligations under section 12, or for any liability that cannot be limited by law.

14. TERMINATION
14.1 Either party may terminate this Agreement by written notice if the other materially breaches it and does not cure the breach within 30 days of notice.
14.2 Intertec may revoke a Licence Key that was obtained by fraud, used in breach of section 3, or whose fees remain unpaid 30 days after notice.
14.3 On termination or expiry without renewal, your licence ends and the Software becomes read-only as described in section 5.2. You will stop using the Software, other than to read and export your Customer Data, and will uninstall it on request. Sections 3, 7 to 10, 13, 15 and 16 survive termination.

15. COMPLIANCE
Each party will comply with the laws that apply to it in performing this Agreement, including anti-bribery, sanctions and export control laws. You will not use, export or re-export the Software in breach of such laws.

16. GENERAL
16.1 Governing law and disputes. This Agreement is governed by the laws of the Emirate of Dubai and the federal laws of the United Arab Emirates. The courts of Dubai have exclusive jurisdiction, unless your Order names another law or forum, in which case your Order applies.
16.2 Order of precedence. If this Agreement and your Order conflict, your Order prevails for the matters it expressly covers.
16.3 Assignment. You may not assign this Agreement without Intertec’s written consent, which will not be unreasonably withheld. Intertec may assign it to an affiliate or to a successor of its business.
16.4 Force majeure. Neither party is liable for delay or failure caused by events beyond its reasonable control, other than payment obligations.
16.5 Notices must be in writing and sent to the addresses in your Order.
16.6 If any part of this Agreement is found unenforceable, the rest remains in force. A failure to enforce a right is not a waiver.
16.7 Entire agreement. This Agreement and your Order are the entire agreement between the parties about the Software and replace all earlier understandings about it.
16.8 Changes. Intertec may publish a new version of this Agreement with a new release or licence. The new version applies once you accept it; until then, the version you accepted continues to apply.`,
};

const SAAS_TERMS: Agreement = {
  version: "saas-terms-2026-11-19",
  title: "Terms of service",
  text: `ARCUS TERMS OF SERVICE
Version saas-terms-2026-11-19

These Terms of Service (the “Terms”) are between the Intertec company named in your order (“Intertec”, “we”, “us”) and the organisation that subscribed to the service (the “Customer”, “you”). They apply to the hosted Arcus service management service, its updates, and its documentation (together, the “Service”).

By selecting “I accept” or using the Service, you confirm that you have read these Terms, that you accept them on behalf of the Customer, and that you are authorised to do so. If you do not accept them, do not use the Service.

1. DEFINITIONS
1.1 “Order” means the quotation, order form or contract between you and Intertec (or an authorised Intertec partner) that lists the edition, number of agents, add-ons, term and fees.
1.2 “Agent” means a named user account that holds an agent or other staff profile. Requesters and portal users who only raise and follow their own requests are not Agents.
1.3 “Customer Data” means all data you or your users put into the Service, including attachments.
1.4 “Users” means the people you allow to use the Service.

2. THE SERVICE
2.1 Subject to these Terms and payment of the fees, Intertec gives you a non-exclusive, non-transferable right, during your subscription, for your Users to access and use the Service for your internal business purposes, within the edition and limits in your Order.
2.2 Intertec runs, maintains, updates and secures the Service. Intertec may improve and change the Service, provided that it does not materially reduce the functionality of your edition during your subscription.
2.3 Planned maintenance will be announced in advance where reasonably possible and scheduled to limit disruption.

3. YOUR RESPONSIBILITIES
3.1 You are responsible for your Users, for keeping their sign-in details secure, and for all activity under their accounts. Tell Intertec promptly of any unauthorised use.
3.2 You are responsible for the content of Customer Data and for having the rights and permissions needed to put it into the Service.
3.3 You must not, and must not allow anyone else to:
(a) use the Service beyond the edition, number of Agents or limits in your Order;
(b) try to gain unauthorised access to the Service, other customers’ data, or the systems behind it, or test its security without Intertec’s written consent;
(c) interfere with or disrupt the Service, or overload it on purpose;
(d) copy, modify, reverse engineer or create derivative works of the Service, except as the law expressly permits;
(e) resell or provide the Service to third parties, unless your Order expressly allows it;
(f) upload malicious code, or use the Service to send spam or break the law or the rights of others.
3.4 Intertec may suspend access that seriously threatens the security or availability of the Service, or that breaks section 3.3, after notice where reasonably possible, and will restore it as soon as the issue is resolved.

4. LIMITS AND USAGE
4.1 Features outside your edition are not available. When a limit is reached, the Service warns your administrators, allows up to 10% more, and then pauses new use of that kind until the limit is raised. Existing data is never deleted because of a limit.
4.2 Intertec measures usage (for example, the number of Agents, configuration items, AI actions and storage) to operate the Service, show it to your administrators, and invoice any additional entitlement you order.

5. CUSTOMER DATA
5.1 You own your Customer Data. Intertec acquires no rights in it, other than the right to host, process and back it up to provide the Service, as you instruct through your use of it.
5.2 Intertec keeps Customer Data logically separated from other customers’ data, protects it with appropriate technical and organisational security measures, and backs it up regularly.
5.3 Intertec processes personal data in Customer Data as your processor, under applicable data protection law, including the UAE Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data. Where your Order includes a data processing agreement, it forms part of these Terms and prevails on data protection matters.
5.4 Intertec will tell you without undue delay after becoming aware of a security incident affecting your Customer Data, and will give reasonable help to deal with it.
5.5 Optional features that use external services (for example, AI assistance or email providers) process data only to provide that feature. AI features can be switched off by your administrators.
5.6 Your administrators can export Customer Data at any time while your subscription is active.

6. SERVICE AVAILABILITY AND SUPPORT
Intertec will use commercially reasonable efforts to make the Service available 24 hours a day, 7 days a week, except for planned maintenance and events beyond its reasonable control. Service levels and support, including any service credits, are as set out in your Order and Intertec’s support terms.

7. FEES AND TAXES
You will pay the fees in your Order, on the terms in your Order. Fees exclude taxes (including VAT), which you will pay except for taxes on Intertec’s income. Fees are non-refundable except as these Terms or your Order expressly state. If fees remain unpaid 30 days after notice, Intertec may suspend the Service until they are paid.

8. TERM, RENEWAL AND END OF SUBSCRIPTION
8.1 Your subscription runs for the term in your Order and renews as your Order states.
8.2 If your subscription ends without renewal, there is a grace period (normally 30 days) in which the Service keeps working and shows a notice. After that, the Service becomes read-only for your Users: they can read and export Customer Data but cannot make changes.
8.3 For 30 days after the end of the grace period, your administrators can still export Customer Data. After that, Intertec will delete Customer Data from the Service, and from backups as they expire on their normal cycle, unless the law requires Intertec to keep it.

9. INTELLECTUAL PROPERTY
9.1 Intertec and its licensors own all rights in the Service and its documentation. All rights not expressly granted to you are reserved.
9.2 The Service uses open-source components, each licensed under its own terms.
9.3 If you send Intertec suggestions or feedback, Intertec may use them without obligation to you.

10. CONFIDENTIALITY
Each party will keep the other’s confidential information confidential, use it only for these Terms, and protect it with at least reasonable care. This does not apply to information that is public through no fault of the receiving party, already known to it, independently developed, or lawfully received from a third party. A party may disclose confidential information when required by law, after giving notice where lawful. Customer Data is your confidential information.

11. WARRANTY
11.1 Intertec warrants that the Service will perform materially as described in its documentation. If it does not, you must tell Intertec, and Intertec will use reasonable efforts to correct it. If Intertec cannot do so within a reasonable time, either party may end the affected subscription and Intertec will refund the prepaid fees for the remaining term. This is your only remedy for breach of this warranty.
11.2 Except as stated in this section, and to the extent the law allows, the Service is provided “as is”, and Intertec disclaims all other warranties, express or implied, including fitness for a particular purpose, merchantability and non-infringement.

12. INTELLECTUAL PROPERTY INDEMNITY
12.1 Intertec will defend you against any third-party claim that the Service, used in line with these Terms, infringes that third party’s intellectual property rights, and will pay the damages and costs finally awarded or agreed in settlement.
12.2 You must tell Intertec promptly about the claim, let Intertec control the defence and settlement, and give reasonable help. Intertec may change the Service so it no longer infringes, or end the subscription and refund the unused prepaid fees.
12.3 This indemnity does not apply to claims caused by Customer Data, your combination of the Service with items not supplied by Intertec, or use beyond these Terms. This section states Intertec’s entire liability for infringement claims.

13. LIMITATION OF LIABILITY
13.1 Neither party is liable for any indirect, incidental, special or consequential loss, or for loss of profit, revenue, business or goodwill, however caused, even if advised of the possibility.
13.2 Each party’s total liability arising out of or relating to these Terms is limited to the fees paid and payable by you to Intertec under the Order in the 12 months before the event giving rise to the claim.
13.3 Sections 13.1 and 13.2 do not limit liability for fraud, for death or personal injury caused by negligence, for breach of confidentiality or of data protection obligations (to the extent the law does not allow it to be limited), for your obligation to pay fees, for your breach of section 3.3, for Intertec’s obligations under section 12, or for any liability that cannot be limited by law.

14. TERMINATION
14.1 Either party may terminate these Terms by written notice if the other materially breaches them and does not cure the breach within 30 days of notice.
14.2 On termination, section 8.2 and 8.3 apply to your access and Customer Data. Sections 7, 9, 10, 13, 15 and 16 survive termination.

15. COMPLIANCE
Each party will comply with the laws that apply to it in performing these Terms, including anti-bribery, sanctions and export control laws.

16. GENERAL
16.1 Governing law and disputes. These Terms are governed by the laws of the Emirate of Dubai and the federal laws of the United Arab Emirates. The courts of Dubai have exclusive jurisdiction, unless your Order names another law or forum, in which case your Order applies.
16.2 Order of precedence. If these Terms and your Order conflict, your Order prevails for the matters it expressly covers.
16.3 Assignment. You may not assign these Terms without Intertec’s written consent, which will not be unreasonably withheld. Intertec may assign them to an affiliate or to a successor of its business.
16.4 Force majeure. Neither party is liable for delay or failure caused by events beyond its reasonable control, other than payment obligations.
16.5 Notices must be in writing and sent to the addresses in your Order. Notices about the Service may also be given in the Service to your administrators.
16.6 If any part of these Terms is found unenforceable, the rest remains in force. A failure to enforce a right is not a waiver.
16.7 Entire agreement. These Terms and your Order are the entire agreement between the parties about the Service and replace all earlier understandings about it.
16.8 Changes. Intertec may publish a new version of these Terms. Your administrators will be asked to accept it in the Service; material changes that reduce your rights apply from your next renewal unless you accept them earlier.`,
};

/**
 * The names an agreement uses: the product ("Arcus") and the company that
 * licenses it ("Intertec"). PRODUCT_NAME and COMPANY_NAME change them for an
 * installation sold under another name; the defaults keep the texts above
 * word for word.
 */
export interface ProductNames {
  product: string;
  company: string;
}

export const DEFAULT_NAMES: ProductNames = { product: "Arcus", company: "Intertec" };

function withNames(a: Agreement, names: ProductNames): Agreement {
  if (names.product === DEFAULT_NAMES.product && names.company === DEFAULT_NAMES.company) return a;
  const text = a.text
    .replace(/ARCUS/g, names.product.toUpperCase())
    .replace(/\bArcus\b/g, names.product)
    .replace(/\bIntertec\b/g, names.company);
  return { ...a, text };
}

/** The agreement for this deployment: the terms of service when hosted (TENANCY on), else the EULA. */
export function agreementFor(saas: boolean, names: ProductNames = DEFAULT_NAMES): Agreement {
  return withNames(saas ? SAAS_TERMS : EULA, names);
}
