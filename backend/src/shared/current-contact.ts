import { badRequest } from "../core/errors.js";
import type { ItopClient } from "../itop/client.js";
import { normalizeObjects } from "../itop/normalize.js";
import { oqlString, str } from "./ticket-mapping.js";

/**
 * The contact id behind the BFF's iTop account.
 *
 * iTop's "My incidents" / "My requests" menus filter on `:current_contact_id`
 * -- the Person linked to the logged-in user. Until the frontend has its own
 * sign-in, "the current user" is the account the BFF authenticates as
 * (ITOP_USER), and this resolves that account's contact id so those views can
 * be served rather than withheld.
 *
 * It talks to the iTop client directly, not through ObjectsService: `UserLocal`
 * is one of the internal classes deliberately excluded from the published
 * schema, so the generic object layer refuses it by design. Resolving identity
 * is exactly the kind of internal lookup that is allowed to reach past the
 * catalogue.
 *
 * Cached after the first lookup; concurrent callers collapse onto one query.
 */
export class CurrentContact {
  private cached?: string;
  private inFlight?: Promise<string>;

  constructor(
    private readonly client: ItopClient,
    private readonly itopUser: string,
  ) {}

  async resolve(): Promise<string> {
    if (this.cached) return this.cached;
    if (!this.inFlight) {
      this.inFlight = this.lookup().finally(() => {
        this.inFlight = undefined;
      });
    }
    this.cached = await this.inFlight;
    return this.cached;
  }

  private async lookup(): Promise<string> {
    const result = await this.client.call("core/get", {
      class: "UserLocal",
      key: `SELECT UserLocal WHERE login = '${oqlString(this.itopUser)}'`,
      output_fields: "id,contactid",
      limit: 1,
    });

    const row = normalizeObjects(result.objects)[0];
    const contactId = str(row?.fields["contactid"]);
    if (!contactId || contactId === "0") {
      // A user with no linked contact cannot own "my" records, so a personal
      // view has no sensible answer. Say so rather than binding to 0, which
      // would silently list every record whose agent is unset.
      throw badRequest(
        `The account "${this.itopUser}" has no linked contact, so personal ` +
          `views ("my incidents") cannot be resolved. Link it to a Person in iTop.`,
      );
    }
    return contactId;
  }
}
