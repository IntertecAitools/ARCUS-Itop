import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { AttachmentsService, MAX_UPLOAD_BYTES } from "../src/modules/attachments/attachments.service.js";
import { ObjectsService } from "../src/platform/objects/objects.service.js";
import { CmdbSchema } from "../src/schema/load.js";
import {
  FakeItopClient,
  getResponse,
  SAMPLE_RAW_SCHEMA,
  sampleNavigation,
  sampleSchema,
  testConfig,
} from "./helpers.js";

/**
 * Attachments, against the contract the installed iTop actually implements.
 *
 * `Attachment` is a standalone class joined to its host through
 * `item_class` + `item_id`, and `contents` is a Blob that crosses REST as
 * base64 JSON. These tests pin the parts that are easy to get subtly wrong:
 * the ownership check, the base64 conversion, and the size reported to the UI.
 */

/** A schema with Attachment and a ticket class to hang it on. */
function attachmentSchema() {
  return CmdbSchema.fromRaw({
    ...SAMPLE_RAW_SCHEMA,
    Ticket: {
      is_ci: false,
      abstract: true,
      inherits: ["cmdbAbstractObject"],
      lifecycle: null,
      writable: ["title"],
      readonly: [],
      fields: { title: { type: "String", ui: "scalar", owner: "Ticket", required: true } },
    },
    Incident: {
      is_ci: false,
      abstract: false,
      inherits: ["cmdbAbstractObject", "Ticket"],
      lifecycle: null,
      writable: ["title"],
      readonly: [],
      fields: { title: { type: "String", ui: "scalar", owner: "Ticket", required: true } },
    },
    Attachment: {
      is_ci: false,
      abstract: false,
      inherits: ["DBObject"],
      lifecycle: null,
      writable: ["item_class", "item_id", "contents", "expire"],
      readonly: [],
      fields: {
        item_class: { type: "String", ui: "scalar", owner: "Attachment" },
        item_id: { type: "ObjectKey", ui: "scalar", owner: "Attachment" },
        contents: { type: "Blob", ui: "scalar", owner: "Attachment" },
        creation_date: { type: "DateTime", ui: "scalar", owner: "Attachment" },
        user_id: { type: "ExternalKey", ui: "picker", owner: "Attachment", target: "Organization" },
        // NOT NULL with a default: iTop fills it, so it must not be demanded.
        expire: {
          type: "DateTime",
          ui: "scalar",
          owner: "Attachment",
          required: true,
          has_default: true,
        },
      },
    },
  } as never);
}

function service(fake: FakeItopClient) {
  const schema = attachmentSchema();
  return new AttachmentsService(new ObjectsService(fake.asClient(), schema, "test"), schema);
}

/** iTop's Blob shape on the wire. */
const blob = (text: string, filename = "notes.txt", mimetype = "text/plain") => ({
  data: Buffer.from(text).toString("base64"),
  mimetype,
  filename,
  downloads_count: 0,
});

const attachmentRow = (id: number, text: string, extra: Record<string, unknown> = {}) => ({
  class: "Attachment",
  id,
  fields: {
    item_class: "Incident",
    item_id: "7",
    creation_date: "2026-10-12 09:00:00",
    user_id: "1",
    user_id_friendlyname: "admin",
    contents: blob(text),
    ...extra,
  },
});

describe("AttachmentsService.list", () => {
  it("queries by item_class and item_id, the way iTop does", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([attachmentRow(3, "hello")]));

    await service(fake).list("Incident", "7");

    const key = String(fake.lastCall().params["key"]);
    assert.match(key, /SELECT Attachment WHERE item_class = 'Incident'/);
    assert.match(key, /item_id = 7/);
  });

  it("reports the decoded byte length, not the base64 length", async () => {
    // iTop stores no size column. Returning the base64 length would overstate
    // every file by a third.
    const fake = new FakeItopClient().on("core/get", getResponse([attachmentRow(3, "hello")]));

    const result = await service(fake).list("Incident", "7");

    assert.equal(result.items[0]?.size, 5);
    assert.equal(result.items[0]?.filename, "notes.txt");
    assert.equal(result.items[0]?.mimeType, "text/plain");
  });

  it("names the uploader from iTop's resolved friendlyname", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([attachmentRow(3, "hi")]));

    const result = await service(fake).list("Incident", "7");

    assert.deepEqual(result.items[0]?.uploadedBy, { id: "1", name: "admin" });
  });

  it("omits the uploader rather than presenting an id as a name", async () => {
    const fake = new FakeItopClient().on(
      "core/get",
      getResponse([attachmentRow(3, "hi", { user_id_friendlyname: "" })]),
    );

    const result = await service(fake).list("Incident", "7");

    assert.equal(result.items[0]?.uploadedBy, undefined);
  });

  it("never returns file bytes from a list", async () => {
    // Listing ten attachments would otherwise ship ten files to the browser.
    const fake = new FakeItopClient().on("core/get", getResponse([attachmentRow(3, "hello")]));

    const result = await service(fake).list("Incident", "7");

    assert.ok(!("content" in (result.items[0] as object)));
  });

  it("rejects a class iTop does not attach to", async () => {
    // itop-attachments allows Ticket and its subclasses; Organization is not.
    const fake = new FakeItopClient();

    await assert.rejects(() => service(fake).list("Organization", "7"), /does not accept attachments/);
  });

  it("rejects an id that is not a number", async () => {
    // item_id is interpolated into OQL, so this is the injection guard too.
    const fake = new FakeItopClient();

    await assert.rejects(() => service(fake).list("Incident", "7 OR 1=1"), /not a valid object id/);
  });
});

describe("AttachmentsService.upload", () => {
  it("sends the file to iTop as base64 under `contents`", async () => {
    const fake = new FakeItopClient()
      .on("core/get", getResponse([{ class: "Incident", id: 7, fields: { id: "7" } }]))
      .on("core/create", getResponse([attachmentRow(9, "payload")]));

    await service(fake).upload("Incident", "7", {
      filename: "notes.txt",
      mimeType: "text/plain",
      content: Buffer.from("payload"),
    });

    const sent = fake.lastCall().params["fields"] as Record<string, unknown>;
    const contents = sent["contents"] as Record<string, unknown>;
    assert.equal(contents["data"], Buffer.from("payload").toString("base64"));
    assert.equal(contents["filename"], "notes.txt");
    assert.equal(contents["mimetype"], "text/plain");
    assert.equal(sent["item_class"], "Incident");
    assert.equal(sent["item_id"], "7");
  });

  it("never sends expire, creation_date or user_id", async () => {
    // iTop owns all three: expire has a default, and user_id is taken from the
    // authenticated account. Sending them would let a caller forge the author.
    const fake = new FakeItopClient()
      .on("core/get", getResponse([{ class: "Incident", id: 7, fields: { id: "7" } }]))
      .on("core/create", getResponse([attachmentRow(9, "payload")]));

    await service(fake).upload("Incident", "7", {
      filename: "a.txt",
      mimeType: "text/plain",
      content: Buffer.from("payload"),
    });

    const sent = fake.lastCall().params["fields"] as Record<string, unknown>;
    assert.ok(!("expire" in sent));
    assert.ok(!("creation_date" in sent));
    assert.ok(!("user_id" in sent));
  });

  it("refuses an empty file", async () => {
    const fake = new FakeItopClient();

    await assert.rejects(
      () =>
        service(fake).upload("Incident", "7", {
          filename: "empty.txt",
          mimeType: "text/plain",
          content: Buffer.alloc(0),
        }),
      /empty/i,
    );
  });

  it("refuses a file over the limit before calling iTop", async () => {
    const fake = new FakeItopClient();

    await assert.rejects(
      () =>
        service(fake).upload("Incident", "7", {
          filename: "big.bin",
          mimeType: "application/octet-stream",
          content: Buffer.alloc(MAX_UPLOAD_BYTES + 1),
        }),
      /limit is/i,
    );
    assert.equal(fake.calls.length, 0, "iTop must not be called for a rejected upload");
  });

  it("refuses to attach to an object that does not exist", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));

    await assert.rejects(
      () =>
        service(fake).upload("Incident", "7", {
          filename: "a.txt",
          mimeType: "text/plain",
          content: Buffer.from("x"),
        }),
      /not found/i,
    );
  });
});

describe("AttachmentsService.download and remove", () => {
  it("returns the decoded bytes", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([attachmentRow(9, "round trip")]));

    const file = await service(fake).download("Incident", "7", "9");

    assert.equal(file.content.toString(), "round trip");
  });

  it("scopes the lookup to the host object", async () => {
    // Without this, an id alone would fetch an attachment belonging to another
    // ticket: an access-control hole that returns 200.
    const fake = new FakeItopClient().on("core/get", getResponse([attachmentRow(9, "x")]));

    await service(fake).download("Incident", "7", "9");

    const key = String(fake.lastCall().params["key"]);
    assert.match(key, /id = 9/);
    assert.match(key, /item_class = 'Incident'/);
    assert.match(key, /item_id = 7/);
  });

  it("404s an attachment that belongs to a different object", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));

    await assert.rejects(() => service(fake).download("Incident", "7", "9"), /was not found/);
  });

  it("checks ownership before deleting", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));

    await assert.rejects(() => service(fake).remove("Incident", "7", "9"), /was not found/);
    assert.ok(
      !fake.calls.some((c) => c.verb === "core/delete"),
      "a delete must not be attempted when the attachment is not on this object",
    );
  });
});

describe("attachment routes", () => {
  function app(fake: FakeItopClient) {
    const schema = attachmentSchema();
    const built = buildApp(testConfig(), {
      client: fake.asClient(),
      schema,
      navigation: sampleNavigation(sampleSchema()),
    });
    after(async () => {
      await built.app.close();
    });
    return built.app;
  }

  it("lists attachments for an object", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([attachmentRow(3, "hello")]));

    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Incident/7/attachments",
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { items: { size: number }[] };
    assert.equal(body.items[0]?.size, 5);
  });

  it("415s an upload that is not multipart", async () => {
    const fake = new FakeItopClient();

    const response = await app(fake).inject({
      method: "POST",
      url: "/api/objects/Incident/7/attachments",
      payload: { file: "nope" },
    });

    assert.equal(response.statusCode, 415);
  });

  it("serves a download as an attachment, never inline", async () => {
    // An uploaded .html or .svg rendered inline would execute in our origin.
    const fake = new FakeItopClient().on("core/get", getResponse([attachmentRow(9, "bytes")]));

    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Incident/7/attachments/9",
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-disposition"] as string, /^attachment;/);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.body, "bytes");
  });

  it("404s an unknown attachment", async () => {
    const fake = new FakeItopClient().on("core/get", getResponse([]));

    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Incident/7/attachments/999",
    });

    assert.equal(response.statusCode, 404);
  });

  it("400s a class iTop will not attach to", async () => {
    const fake = new FakeItopClient();

    const response = await app(fake).inject({
      method: "GET",
      url: "/api/objects/Organization/1/attachments",
    });

    assert.equal(response.statusCode, 400);
  });
});
