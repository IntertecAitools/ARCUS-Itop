import DependencyGraph from "@/components/dependency-graph";
import DemoForm from "@/components/demo-form";
import {
  Credibility,
  Features,
  Footer,
  Highlights,
  Nav,
  Section,
  Solution,
  Workflows,
} from "@/components/sections";

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        {/* Hero */}
        <section className="px-6 pb-8 pt-14 sm:pt-20">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="eyebrow">Service management and asset tracking</p>
              <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-[56px]">
                Know what breaks before you touch it.
              </h1>
              <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-ink-2">
                Weftbase maps every server, service and dependency in your estate, so a change you make
                on Friday doesn&rsquo;t page you on Saturday.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#demo"
                  className="focusable rounded-md bg-accent px-5 py-3 font-semibold text-bg hover:bg-accent-hover"
                >
                  Book a demo
                </a>
                <a
                  href="#features"
                  className="focusable rounded-md border border-edge px-5 py-3 font-semibold text-ink hover:border-ink-3"
                >
                  Explore a live instance
                </a>
              </div>
              <p className="mt-8 max-w-[52ch] text-sm leading-relaxed text-ink-3">
                Somebody reboots a box labelled <span className="font-mono text-ink-2">APP-TEST-04</span>.
                It was running the nightly invoicing for your largest client. Nobody was careless — the
                information simply did not exist anywhere.
              </p>
            </div>

            <div className="card p-4 sm:p-6">
              <DependencyGraph />
            </div>
          </div>
        </section>

        <Features />
        <Solution />
        <Workflows />
        <Highlights />
        <Credibility />

        {/* Demo */}
        <Section id="demo" eyebrow="Get started" title="See it on your own estate">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="max-w-[52ch] text-ink-2">
                30 minutes, no slide deck. Bring a list of your servers and we&rsquo;ll map them live.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  ["No credit card", "Nothing to sign before you have seen it work."],
                  ["Your data stays yours", "It sits in your database, and you can take it with you."],
                  ["Runs on your infrastructure", "On your servers or ours, whichever you prefer."],
                ].map(([t, d]) => (
                  <li key={t} className="flex gap-3">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>
                      <span className="font-medium">{t}</span>
                      <span className="block text-sm text-ink-3">{d}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <DemoForm />
          </div>
        </Section>
      </main>
      <Footer />
    </>
  );
}
