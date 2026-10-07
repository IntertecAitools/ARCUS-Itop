import { describe, expect, it } from 'vitest';
import { isModuleRegistered, modules, navGroups } from './modules';

/**
 * The registry is the single source of truth for nav, routes and the command
 * palette. These tests protect the invariants all three rely on.
 */
describe('module registry', () => {
  it('has unique ids', () => {
    const ids = modules.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique paths, so no two modules fight over a route', () => {
    const paths = modules.map((m) => m.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('uses paths without a leading slash — the router adds it', () => {
    for (const m of modules) {
      expect(m.path.startsWith('/')).toBe(false);
    }
  });

  it('places every module in a known nav group', () => {
    for (const m of modules) {
      expect(navGroups).toContain(m.group);
    }
  });

  it('gives every module a label and a description for the palette', () => {
    for (const m of modules) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
    }
  });

  it('only registers modules that are actually built', () => {
    // A registered module must have a component. The type enforces this, so
    // this guards against a cast or a stray `as never` slipping one through.
    for (const m of modules) {
      expect(m.component).toBeDefined();
    }
  });
});

describe('isModuleRegistered', () => {
  it('recognises a built module, with or without a sub-path or query', () => {
    expect(isModuleRegistered('/dashboard')).toBe(true);
    expect(isModuleRegistered('/dashboard/anything')).toBe(true);
    expect(isModuleRegistered('/dashboard?range=7d')).toBe(true);
  });

  it('recognises incidents now that the module is built', () => {
    expect(isModuleRegistered('/incidents')).toBe(true);
    expect(isModuleRegistered('/incidents/42')).toBe(true);
  });

  it('rejects a module that has not been built', () => {
    // Cross-links in the UI hang off this, so an unbuilt module must never
    // report as present — that is what stops the dashboard offering dead links.
    expect(isModuleRegistered('/problems')).toBe(false);
    expect(isModuleRegistered('/changes')).toBe(false);
    expect(isModuleRegistered('/knowledge')).toBe(false);
  });
});
