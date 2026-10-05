"use client";

import { useState } from "react";

export function Logo({ className = "" }: { className?: string }) {
  // The weave: threads crossing, with a break where one passes under.
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M7 2.5v6" />
        <path d="M7 11.5v10" />
        <path d="M17 2.5v10" />
        <path d="M17 15.5v6" />
        <path d="M2.5 7h6" />
        <path d="M11.5 7h10" />
        <path d="M2.5 17h10" />
        <path d="M15.5 17h6" />
      </g>
    </svg>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);
  const links = [
    ["Product", "#features"],
    ["Solution", "#solution"],
    ["Workflows", "#workflows"],
    ["Pricing", "#demo"],
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-edge/60 bg-bg/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <a href="#" className="focusable flex items-center gap-2.5 font-semibold tracking-tight">
          <Logo className="h-5 w-5 text-accent" />
          Weftbase
        </a>
        <div className="hidden items-center gap-7 md:flex">
          {links.map(([l, h]) => (
            <a key={l} href={h} className="focusable text-sm text-ink-2 hover:text-ink">
              {l}
            </a>
          ))}
          <a href="#demo" className="focusable text-sm text-ink-2 hover:text-ink">
            Explore a live instance
          </a>
          <a
            href="#demo"
            className="focusable rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-hover"
          >
            Book a demo
          </a>
        </div>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Menu"
          className="focusable md:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M5 5l14 14M19 5L5 19" /> : <path d="M3 7h18M3 12h18M3 17h18" />}
          </svg>
        </button>
      </nav>
      {open && (
        <div className="border-t border-edge bg-bg px-6 py-4 md:hidden">
          {[...links, ["Book a demo", "#demo"]].map(([l, h]) => (
            <a
              key={l}
              href={h}
              onClick={() => setOpen(false)}
              className="focusable block py-2.5 text-ink-2"
            >
              {l}
            </a>
          ))}
        </div>
      )}
    </header>
  );
}

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title?: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-t border-edge/50 px-6 py-16 sm:py-24">
      <div className="mx-auto max-w-[1200px]">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        {title && <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>}
        {lead && <p className="mt-3 max-w-[62ch] text-ink-2">{lead}</p>}
        <div className={title ? "mt-10" : ""}>{children}</div>
      </div>
    </section>
  );
}

const FEATURES = [
  ["See what a change will break", "Every server, VM and service is linked, so the blast radius shows up before you touch anything."],
  ["Stop losing requests in inboxes", "One queue with an owner, a priority and a state. Nothing sits unanswered because nobody noticed."],
  ["Fix causes, not symptoms", "History builds up against the thing itself, so the fault you keep patching becomes visible."],
  ["Prove your service levels", "Response and resolution clocks run per contract, so a service review is evidence, not opinion."],
  ["Keep customers apart", "Per-customer scoping is built in, so one instance serves many clients without leaking between them."],
  ["Connect what you already run", "A REST API and a sync framework, so monitoring and discovery can feed it instead of people typing."],
];

export function Features() {
  return (
    <Section
      id="features"
      eyebrow="What it does"
      title="Built around the question nobody can answer"
      lead="Not another ticket queue. The difference is that everything is linked to everything it depends on."
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([t, d]) => (
          <div key={t} className="card p-6">
            <Logo className="h-5 w-5 text-accent" />
            <h3 className="mt-4 text-[17px] font-semibold">{t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Solution() {
  const steps = [
    ["Map", "Pull your estate in from the tools you already run, then link what depends on what."],
    ["Operate", "Run incidents, requests and changes against that map, not against a spreadsheet."],
    ["Prove", "Service levels, change records and audit evidence come out of the day job, not a scramble."],
  ];
  return (
    <Section
      id="solution"
      eyebrow="How it works"
      title="Map, operate, prove"
      lead="A spreadsheet can list your servers. It cannot tell you what stops when one of them does."
    >
      <div className="grid gap-px overflow-hidden rounded-lg border border-edge bg-edge sm:grid-cols-3">
        {steps.map(([t, d], i) => (
          <div key={t} className="bg-bg p-7">
            <span className="font-mono text-sm text-accent">0{i + 1}</span>
            <h3 className="mt-3 text-xl font-semibold">{t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

const FLOWS: Record<string, string[]> = {
  Incident: ["New", "Assigned", "Working", "Pending", "Resolved", "Closed"],
  Request: ["New", "Approved", "Assigned", "Working", "Delivered", "Closed"],
  Change: ["Draft", "Approval", "Scheduled", "Implementing", "Review", "Closed"],
  Problem: ["Logged", "Investigating", "Known error", "Fix planned", "Resolved", "Closed"],
};

export function Workflows() {
  const [tab, setTab] = useState<keyof typeof FLOWS>("Incident");
  const steps = FLOWS[tab];
  const active = 2;
  return (
    <Section
      id="workflows"
      eyebrow="Workflows"
      title="The processes, already built"
      lead="Incident, request, change and problem come configured to ITIL, and you can change any of it."
    >
      <div role="tablist" aria-label="Workflow types" className="flex flex-wrap gap-2">
        {Object.keys(FLOWS).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k as keyof typeof FLOWS)}
            className={`focusable rounded-md border px-4 py-2 text-sm ${
              tab === k ? "border-accent bg-accent/10 text-ink" : "border-edge text-ink-2 hover:text-ink"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="card mt-6 overflow-x-auto p-7">
        <div className="flex min-w-[640px] items-center">
          {steps.map((s, i) => (
            <div key={s} className="flex flex-1 items-center">
              <div
                className={`rounded-md border px-3 py-2 text-center text-[13px] ${
                  i === active ? "border-accent bg-accent/10 text-ink" : "border-edge text-ink-2"
                }`}
              >
                {s}
              </div>
              {i < steps.length - 1 && <div className="h-px flex-1 bg-edge" />}
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm text-ink-2">
          Each move can trigger something: notify the owner, start an approval, stop an SLA clock, or
          write the change record you will need at audit.
        </p>
      </div>
    </Section>
  );
}

export function Highlights() {
  const stats = [
    ["60+", "asset types modelled out of the box"],
    ["4", "ITIL processes configured and ready"],
    ["REST", "API for anything you already run"],
    ["Weeks", "to first value, not quarters"],
  ];
  return (
    <Section>
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([n, l]) => (
          <div key={l}>
            <p className="font-mono text-[40px] leading-none tracking-tight">{n}</p>
            <p className="mt-3 text-sm text-ink-3">{l}</p>
          </div>
        ))}
      </div>
      <p className="mt-10 max-w-[62ch] text-sm text-ink-3">
        Figures describe the product, not customer outcomes. We will put real numbers here when we have
        customers to source them from.
      </p>
    </Section>
  );
}

export function Credibility() {
  return (
    <Section>
      <div className="card flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Built on iTop, the open-source ITSM platform</h3>
          <p className="mt-1.5 max-w-[62ch] text-sm text-ink-2">
            Your data stays in your database. No lock-in, and no single vendor standing between you and
            your own estate.
          </p>
        </div>
        <a href="#demo" className="focusable shrink-0 text-sm text-accent underline underline-offset-4">
          See it on your estate
        </a>
      </div>
    </Section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-edge px-6 py-12">
      <div className="mx-auto grid max-w-[1200px] gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5 font-semibold">
            <Logo className="h-5 w-5 text-accent" />
            Weftbase
          </div>
          <p className="mt-3 max-w-[32ch] text-sm text-ink-3">
            Service management and asset tracking for IT teams and managed service providers.
          </p>
        </div>
        {[
          ["Product", ["Features", "Workflows", "Pricing"]],
          ["Resources", ["Documentation", "Guides", "Support"]],
          ["Company", ["About", "Contact", "Privacy"]],
        ].map(([h, items]) => (
          <div key={h as string}>
            <p className="text-sm font-semibold">{h as string}</p>
            <ul className="mt-3 space-y-2">
              {(items as string[]).map((i) => (
                <li key={i}>
                  <a href="#" className="focusable text-sm text-ink-3 hover:text-ink-2">
                    {i}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 max-w-[1200px] border-t border-edge/60 pt-6 text-xs text-ink-3">
        <p>© {new Date().getFullYear()} Weftbase. Built on iTop, an open-source project by Combodo.</p>
      </div>
    </footer>
  );
}
