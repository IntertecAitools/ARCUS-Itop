import { badRequest } from "../core/errors.js";
import type { ItopClient } from "../itop/client.js";
import { normalizeObjects } from "../itop/normalize.js";
import { oqlString, str } from "./ticket-mapping.js";
import { currentCaller } from "../core/request-context.js";

/**
 * The contact id behind the BFF's iTop account.
 *
 * iTop's "My incidents" / "My requests" menus filter on `:current_contact_id`
 * -- the Person linked to the logged-in user. Until the frontend has its own
 * sign-in, "the current user" is the account the BFF authenticates as
 * (ITOP_USER), and this resolves that account's contact id so those views can
 * be served rather than withheld.
 *
 * It queries the abstract `User` class, not `UserLocal`: OQL is polymorphic, so
 * this finds the account whether it is local, LDAP or external, and `contactid`
 * is declared on `User` itself. It talks to the iTop client directly because
 * resolving identity is an internal lookup, not something the published
 * object catalogue needs to allow.
 *
 * Cached after the first successful lookup; concurrent callers collapse onto
 * one query.
 */
export class CurrentContact {
  private cached?: string;
  private inFlight?: Promise<string | null>;

  constructor(
    private readonly client: ItopClient,
    private readonly itopUser: string,
  ) {}

  /** The contact id, or a 400 explaining why personal views cannot be served. */
  async resolve(): Promise<string> {
    const contactId = await this.tryResolve();
    if (!contactId) {
      // A user with no linked contact cannot own "my" records, so a personal
      // view has no sensible answer. Say so rather than binding to 0, which
      // would silently list every record whose agent is unset.
      throw badRequest(
        `The account "${currentCaller()?.login ?? this.itopUser}" has no linked contact, so personal ` +
          `views ("my incidents") cannot be resolved. Link it to a Person in iTop.`,
      );
    }
    return contactId;
  }

  /**
   * The contact id, or null when the account has none.
   *
   * The signed-in user's own contact when there is a session -- "my
   * incidents" are theirs. Without one (sign-in turned off) it falls back to
   * the service account's, as before.
   */
  async tryResolve(): Promise<string | null> {
    const caller = currentCaller();
    if (caller) return caller.contactId > 0 ? String(caller.contactId) : null;
    if (this.cached) return this.cached;
    this.inFlight ??= this.lookup().finally(() => {
      this.inFlight = undefined;
    });
    const contactId = await this.inFlight;
    if (contactId) this.cached = contactId;
    return contactId;
  }

  private async lookup(): Promise<string | null> {
    const result = await this.client.call(
      "core/get",
      {
        class: "User",
        key: `SELECT User WHERE login = '${oqlString(this.itopUser)}'`,
        output_fields: "id,contactid",
        limit: 1,
      },
      { asService: true },
    );

    const row = normalizeObjects(result.objects)[0];
    const contactId = str(row?.fields["contactid"]);
    return contactId && contactId !== "0" ? contactId : null;
  }
}
