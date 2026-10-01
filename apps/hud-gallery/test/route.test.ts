import { describe, expect, it } from 'vitest';
import { formatParams, matrixHref, parseParams, parseRoute, storyHref } from '../src/app/route.ts';

describe('gallery routes', () => {
  it('index, story, matrix, unknown', () => {
    expect(parseRoute('')).toEqual({ kind: 'index', params: { shot: false } });
    expect(parseRoute('#/')).toEqual({ kind: 'index', params: { shot: false } });
    expect(parseRoute('#/story/resource-meter--stall')).toEqual({ kind: 'story', id: 'resource-meter--stall', params: { shot: false } });
    expect(parseRoute('#/matrix/CardCell?locale=en')).toEqual({ kind: 'matrix', component: 'CardCell', params: { shot: false, locale: 'en' } });
    expect(parseRoute('#/foo/bar/baz').kind).toBe('unknown');
  });

  it('query parameters (contract: locale, scale, teams, motion, shot)', () => {
    expect(parseParams('locale=pseudo&scale=1.25&teams=cvd&motion=reduce&shot=1')).toEqual({
      locale: 'pseudo',
      scale: 1.25,
      teams: 'cvd',
      motion: 'reduce',
      shot: true,
    });
    // Invalid values are ignored.
    expect(parseParams('locale=fr&scale=9&teams=pink&motion=fast&shot=yes')).toEqual({ shot: false });
  });

  it('hrefs round-trip', () => {
    const href = storyHref('card-cell--hover', { locale: 'en', scale: 0.8, teams: 'relation', shot: true });
    expect(href).toBe('#/story/card-cell--hover?locale=en&scale=0.8&teams=relation&shot=1');
    expect(parseRoute(href)).toEqual({
      kind: 'story',
      id: 'card-cell--hover',
      params: { locale: 'en', scale: 0.8, teams: 'relation', shot: true },
    });
    expect(matrixHref('Settings')).toBe('#/matrix/Settings');
    expect(formatParams({ shot: false })).toBe('');
  });
});
