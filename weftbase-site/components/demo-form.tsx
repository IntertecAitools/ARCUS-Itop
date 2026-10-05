"use client";

import { useState } from "react";

type Errors = Partial<Record<"name" | "email" | "company", string>>;

export default function DemoForm() {
  const [values, setValues] = useState({ name: "", email: "", company: "", message: "", website: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  const validate = (field: keyof Errors, v: string): string | undefined => {
    if (field === "name" && !v.trim()) return "Please tell us your name.";
    if (field === "company" && !v.trim()) return "Please tell us where you work.";
    if (field === "email") {
      if (!v.trim()) return "We need an email address to reply to.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "That does not look like an email address.";
    }
    return undefined;
  };

  const onBlur = (field: keyof Errors) => {
    const msg = validate(field, values[field]);
    setErrors((e) => ({ ...e, [field]: msg }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    (["name", "email", "company"] as const).forEach((f) => {
      const m = validate(f, values[f]);
      if (m) next[f] = m;
    });
    setErrors(next);
    if (Object.keys(next).length) return;

    setState("sending");
    try {
      const res = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <div className="card p-8" role="status">
        <h3 className="text-xl font-semibold">Thanks — that is booked in.</h3>
        <p className="mt-3 text-ink-2">
          We will reply within one business day to arrange a time. No sequences, no newsletter.
        </p>
      </div>
    );
  }

  const field = (
    id: "name" | "email" | "company",
    label: string,
    type = "text",
    hint?: string,
    autoComplete?: string
  ) => (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        placeholder={hint}
        value={values[id]}
        onChange={(e) => setValues({ ...values, [id]: e.target.value })}
        onBlur={() => onBlur(id)}
        aria-invalid={!!errors[id]}
        aria-describedby={errors[id] ? `${id}-error` : undefined}
        className="focusable w-full rounded-md border border-edge bg-surface-2 px-3.5 py-2.5 text-ink placeholder:text-ink-3"
      />
      {errors[id] && (
        <p id={`${id}-error`} className="mt-1.5 flex items-center gap-1.5 text-[13px] text-critical">
          <span aria-hidden>!</span>
          {errors[id]}
        </p>
      )}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="card space-y-4 p-6 sm:p-8">
      {field("name", "Your name", "text", undefined, "name")}
      {field("email", "Work email", "email", "you@company.com", "email")}
      {field("company", "Company", "text", undefined, "organization")}

      <div>
        <label htmlFor="message" className="mb-1.5 block text-sm font-medium text-ink">
          What would you like to see? <span className="text-ink-3">(optional)</span>
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          placeholder="We run about 300 servers across two sites…"
          value={values.message}
          onChange={(e) => setValues({ ...values, message: e.target.value })}
          className="focusable w-full rounded-md border border-edge bg-surface-2 px-3.5 py-2.5 text-ink placeholder:text-ink-3"
        />
      </div>

      {/* honeypot — real people never see this */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={values.website}
        onChange={(e) => setValues({ ...values, website: e.target.value })}
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <button
        type="submit"
        disabled={state === "sending"}
        className="focusable w-full rounded-md bg-accent px-5 py-3 font-semibold text-bg transition-colors hover:bg-accent-hover disabled:opacity-70"
      >
        {state === "sending" ? "Sending…" : "Book a demo"}
      </button>

      <p className="text-[13px] text-ink-3">
        We will reply within one business day. No sequences, no newsletter.
      </p>

      {state === "error" && (
        <p role="status" className="text-[13px] text-critical">
          Something went wrong our end. Try again, or email{" "}
          <a className="underline" href="mailto:sales@weftbase.com">
            sales@weftbase.com
          </a>{" "}
          — your answers are still here.
        </p>
      )}
    </form>
  );
}
