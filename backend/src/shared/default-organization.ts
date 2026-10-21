import { badRequest } from "../core/errors.js";
import type { ObjectsService } from "../platform/objects/objects.service.js";
import type { CurrentContact } from "./current-contact.js";
import { str } from "./ticket-mapping.js";
import { currentCaller, runAs, runAsServiceAccount } from "../core/request-context.js";

/**
 * Resolves the organisation a record belongs to when the UI does not ask.
 *
 * iTop marks `org_id` NOT NULL on Person, Team, Incident and UserRequest, so
 * something must supply it. Asking every reporter which company they work for
 * is noise in a single-tenant helpdesk, so the server answers it instead.
 *
 * Resolution order, most specific first:
 *   1. ITOP_DEFAULT_ORG_ID, when an operator has pinned one.
 *   2. The organisation of the Person behind the iTop account the BFF
 *      authenticates as — "the logged-in user's company".
 *   3. The only organisation in the instance, if there is exactly one.
 *
 * Deliberately refuses to guess when several organisations exist and none of
 * the above resolves: silently filing tickets against an arbitrary company is
 * worse than a clear error.
 *
 * Cached for the process lifetime. This changes about as often as the company
 * does, and it sits on the create path for every ticket.
 */
export class DefaultOrganization {
  private cached?: string;
  private inFlight?: Promise<string>;

  constructor(
    private readonly objects: ObjectsService,
    private readonly currentContact: CurrentContact,
    private readonly pinnedId?: string,
  ) {}

  async resolve(): Promise<string> {
    if (this.pinnedId) return this.pinnedId;
    // A signed-in user's records belong to their own organisation.
    const caller = currentCaller();
    if (caller && caller.orgId > 0) return String(caller.orgId);
    // Anyone else gets the instance's default, worked out by the service
    // account with nobody bound: worked out as the caller, it would follow
    // their contact and their view of the organisations -- and the cache
    // would hand that to every user after them.
    if (caller) return runAs(undefined, () => runAsServiceAccount(() => this.resolve()));
    if (this.cached) return this.cached;
    // Collapse concurrent callers onto one lookup; the create path is hot and
    // iTop answers in seconds.
    this.inFlight ??= this.lookup().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /** Test seam, and a way to drop the cache if an operator repoints it. */
  reset(): void {
    this.cached = undefined;
  }

  private async lookup(): Promise<string> {
    if (this.pinnedId) {
      this.cached = this.pinnedId;
      return this.cached;
    }

    const fromAccount = await this.organizationOfServiceAccount();
    if (fromAccount) {
      this.cached = fromAccount;
      return this.cached;
    }

    const organizations = await this.objects.list("Organization", {
      page: 1,
      limit: 2,
      oql: "SELECT Organization",
      fields: "id,name",
    });

    if (organizations.total === 1 && organizations.items[0]) {
      this.cached = String(organizations.items[0].id);
      return this.cached;
    }

    if (organizations.total === 0) {
      throw badRequest(
        "No organisation exists yet. Create one before raising a ticket.",
      );
    }

    throw badRequest(
      `This instance has ${organizations.total} organisations and none is set as the default. ` +
        "Set ITOP_DEFAULT_ORG_ID, or supply organizationId on the request.",
    );
  }

  /**
   * The service account's contact -> Person.org_id, when it has a contact.
   *
   * The account is resolved through CurrentContact, which queries iTop
   * directly: `UserLocal` and its siblings are not part of the published
   * schema, so asking ObjectsService for them always failed and this rule
   * never applied.
   */
  private async organizationOfServiceAccount(): Promise<string | null> {
    try {
      const contactId = await this.currentContact.tryResolve();
      if (!contactId) return null;

      const people = await this.objects.list("Person", {
        page: 1,
        limit: 1,
        oql: `SELECT Person WHERE id = ${Number(contactId)}`,
        fields: "id,org_id",
      });

      const orgId = str(people.items[0]?.fields["org_id"]);
      return orgId && orgId !== "0" ? orgId : null;
    } catch {
      // The contact may be a Team, or the account unreadable on this
      // instance; fall through to the single-organisation rule rather than
      // failing the create outright.
      return null;
    }
  }
}
