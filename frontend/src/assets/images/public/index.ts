/**
 * The pictures on the public pages (landing, sign-in, portal), by slot.
 *
 * Every file here is an abstract placeholder drawn for this app. To use your
 * organisation's own photos, see README.md in this folder: replace a file, or
 * point a slot at a new one. Nothing else needs to change.
 */
import hero from './hero.svg';
import requests from './requests.svg';
import answers from './answers.svg';

export const publicImagery = {
  /** Landing hero and the sign-in side panel. */
  hero,
  /** Landing: "follow your requests" row. */
  requests,
  /** Landing: knowledge-base row, portal help teaser. */
  answers,
} as const;
