import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the one architectural rule this app has:
 *
 *   browser -> frontend -> BFF -> iTop
 *
 * The frontend NEVER reaches iTop directly and never speaks its language. If
 * it did, iTop's quirks (OQL, `Class::id` keys, RestResult codes, a numeric
 * priority that is secretly derived) would leak into screens, and every one of
 * them would have to be fixed in every screen.
 *
 * These assertions run over the real source tree, so the rule is enforced
 * rather than merely documented.
 */

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

describe('the frontend talks only to the BFF', () => {
  it('finds source files to check', () => {
    // A silent zero here would make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(40);
  });

  it('never references iTop directly', () => {
    const offenders = files
      .filter(({ text }) => /localhost:8080|webservices\/rest\.php|itop\.php/i.test(text))
      .map(({ path }) => path);

    expect(offenders, 'these files point at iTop instead of the BFF').toEqual([]);
  });

  it('never writes OQL', () => {
    // OQL is iTop's query language. Its presence means a screen is reasoning
    // about iTop's datamodel, which is the BFF's job.
    const offenders = files
      .filter(({ text }) => /\bSELECT\s+[A-Z]\w+\s+(WHERE|JOIN)\b/.test(text))
      .map(({ path }) => path);

    expect(offenders, 'these files contain OQL').toEqual([]);
  });

  it('routes every HTTP call through the api client', () => {
    // `fetch` anywhere but the api client bypasses base URL, credentials and
    // error normalisation — the three things that make failures legible.
    const offenders = files
      .filter(({ path }) => !path.startsWith('lib/api-client/'))
      .filter(({ path }) => !path.startsWith('mocks/'))
      .filter(({ text }) => /(?<![.\w])fetch\s*\(/.test(text))
      .map(({ path }) => path);

    expect(offenders, 'these files call fetch directly').toEqual([]);
  });

  it('keeps iTop vocabulary out of the UI', () => {
    // Our DTOs say `in_progress`, never iTop's `ev_resolve` or `escalated_ttr`.
    // The mock handlers mirror the BFF's responses, so they are exempt.
    const offenders = files
      .filter(({ path }) => !path.startsWith('mocks/'))
      .filter(({ text }) => /\bev_(assign|resolve|close|reopen|pending|reassign)\b|escalated_tt[or]/.test(text))
      .map(({ path }) => path);

    expect(offenders, 'these files use iTop stimulus or state names').toEqual([]);
  });
});
