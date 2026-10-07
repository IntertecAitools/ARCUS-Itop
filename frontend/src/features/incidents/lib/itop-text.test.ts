import { describe, expect, it } from 'vitest';
import { humanise, toPlainText } from './itop-text';

describe('toPlainText', () => {
  it('strips the paragraph tags iTop wraps text in', () => {
    // Without this the UI literally renders "<p>Raised by…</p>" on screen.
    expect(toPlainText('<p>Raised by an end-to-end test.</p>')).toBe(
      'Raised by an end-to-end test.',
    );
  });

  it('turns paragraph breaks into blank lines', () => {
    expect(toPlainText('<p>First</p><p>Second</p>')).toBe('First\n\nSecond');
  });

  it('turns <br> into a newline', () => {
    expect(toPlainText('one<br>two')).toBe('one\ntwo');
  });

  it('decodes the entities iTop escapes', () => {
    expect(toPlainText('<p>Tom &amp; Jerry&#39;s &quot;fix&quot;</p>')).toBe(
      'Tom & Jerry\'s "fix"',
    );
  });

  it('neutralises markup rather than rendering it', () => {
    // The output is used as TEXT, never as innerHTML. Proving the tags are
    // gone is what keeps a caller-supplied description from becoming XSS.
    const result = toPlainText('<script>alert(1)</script>hello');
    expect(result).not.toContain('<script>');
    expect(result).toContain('hello');
  });

  it('bullets list items instead of running them together', () => {
    expect(toPlainText('<ul><li>one</li><li>two</li></ul>')).toBe('• one\n• two');
  });

  it('returns an empty string for missing values', () => {
    expect(toPlainText(undefined)).toBe('');
    expect(toPlainText(null)).toBe('');
    expect(toPlainText('')).toBe('');
  });

  it('collapses the blank lines stripping leaves behind', () => {
    expect(toPlainText('<div><p>a</p></div><div><p>b</p></div>')).toBe('a\n\nb');
  });
});

describe('humanise', () => {
  it('turns an iTop enum value into a readable label', () => {
    expect(humanise('in_person')).toBe('In person');
    expect(humanise('software patch')).toBe('Software patch');
  });

  it('handles missing values', () => {
    expect(humanise(undefined)).toBe('');
    expect(humanise('')).toBe('');
  });
});
