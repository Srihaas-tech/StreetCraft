import { describe, expect, it } from 'vitest';
import { mountStreetCraftApp } from '../src/app';

describe('StreetCraft web bootstrap', () => {
  it('mounts a public Street View entry point', () => {
    const container = document.createElement('div');

    mountStreetCraftApp(container);

    expect(container.querySelector('h1')?.textContent).toBe('StreetCraft');
    expect(container.textContent).toContain('Public Street View');
  });
});
