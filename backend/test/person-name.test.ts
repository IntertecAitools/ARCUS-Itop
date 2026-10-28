import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { personName, TICKET_FIELDS, toTicket } from "../src/shared/ticket-mapping.js";

describe("personName", () => {
  it("uses the full name iTop gives in <key>_id_friendlyname", () => {
    assert.equal(personName({ agent_id_friendlyname: "Demo Agent", agent_name: "Agent" }, "agent"), "Demo Agent");
  });

  it("falls back to the surname field when the full name is absent", () => {
    assert.equal(personName({ caller_name: "Agent" }, "caller"), "Agent");
  });

  it("treats iTop's ' ' for an empty link as no name", () => {
    assert.equal(personName({ manager_id_friendlyname: " " }, "manager"), "");
  });
});

describe("toTicket assignee", () => {
  it("asks iTop for the agent's full name", () => {
    assert.match(TICKET_FIELDS, /\bagent_id_friendlyname\b/);
  });

  it("shows the agent as first name + surname", () => {
    const ticket = toTicket({
      id: 9,
      class: "Incident",
      fields: { ref: "I-000009", agent_id: "4", agent_id_friendlyname: "Demo Agent", agent_name: "Agent" },
    } as never);
    assert.deepEqual(ticket.assignee, { id: "4", name: "Demo Agent" });
  });
});
