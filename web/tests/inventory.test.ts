import { describe, expect, it } from 'vitest';
import { ItemAtlas } from '../src/inventory/item-atlas';
import { InventoryScreen, type InventoryData } from '../src/inventory/inventory-screen';

function inventory(
  overrides: Partial<InventoryData> = {},
): InventoryData {
  return {
    containerType: 'chest',
    size: 27,
    items: [],
    ...overrides,
  };
}

function item(slot: number, overrides: Partial<InventoryData['items'][number]> = {}) {
  return {
    slot,
    itemId: 'minecraft:diamond_sword',
    count: 1,
    displayName: 'Diamond Sword',
    safeTooltipData: { damage: 25, maxDamage: 100, glint: false },
    ...overrides,
  };
}

function open(data: InventoryData) {
  const screen = new InventoryScreen({
    document,
    atlas: new ItemAtlas('/deterministic-items/'),
  });
  expect(screen.open(data)).toEqual({ ok: true });
  return screen;
}

describe('ItemAtlas', () => {
  it('resolves valid vanilla item identifiers against its injected base', () => {
    const atlas = new ItemAtlas('/deterministic-items/');

    expect(atlas.resolve('minecraft:diamond_sword')).toEqual({
      kind: 'image',
      src: '/deterministic-items/diamond_sword.png',
    });
  });

  it('uses a deterministic fallback for malformed and non-vanilla identifiers', () => {
    const atlas = new ItemAtlas('/deterministic-items/');

    expect(atlas.resolve('minecraft:../command_block')).toEqual({
      kind: 'fallback',
      label: 'minecraft:../command_block',
    });
    expect(atlas.resolve('example:laser')).toEqual({
      kind: 'fallback',
      label: 'example:laser',
    });
  });
});

describe('InventoryScreen', () => {
  it.each([
    ['chest', 'Chest'],
    ['barrel', 'Barrel'],
    ['shulker_box', 'Shulker Box'],
  ] as const)('renders an exact 27-slot %s grid', (containerType, title) => {
    const screen = open(inventory({ containerType }));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

    expect(dialog?.querySelectorAll('[data-slot]')).toHaveLength(27);
    expect(dialog?.querySelector('[data-slot="26"]')).not.toBeNull();
    expect(dialog?.querySelector('h2')?.textContent).toBe(title);
    screen.close();
  });

  it('renders 54 literal slots and retains a sparse server slot index', () => {
    const screen = open(inventory({
      containerType: 'double_chest',
      size: 54,
      items: [item(53, { displayName: 'Last Slot' })],
    }));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

    expect(dialog?.querySelectorAll('[data-slot]')).toHaveLength(54);
    expect(dialog?.querySelector('[data-slot="53"]')?.getAttribute('aria-label')).toContain('Last Slot');
    expect(dialog?.querySelector('[data-slot="0"]')?.textContent).toBe('');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Large Chest');
    screen.close();
  });

  it('renders stack counts only above one and supplies accessible item names', () => {
    const screen = open(inventory({
      items: [item(1, { count: 64, displayName: 'Diamond <Sword>' }), item(2)],
    }));

    const stack = document.querySelector('[data-slot="1"]');
    expect(stack?.querySelector('.inventory-count')?.textContent).toBe('64');
    expect(document.querySelector('[data-slot="2"] .inventory-count')).toBeNull();
    expect(stack?.getAttribute('aria-label')).toContain('Diamond <Sword>');
    expect(stack?.querySelector('img')?.getAttribute('alt')).toBe('');
    screen.close();
  });

  it('shows a safe tooltip on hover and focus with bounded durability', () => {
    const screen = open(inventory({
      items: [item(4, { safeTooltipData: { damage: 120, maxDamage: 100, glint: false } })],
    }));
    const slot = document.querySelector<HTMLElement>('[data-slot="4"]')!;

    slot.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(document.querySelector('.inventory-tooltip')?.textContent)
      .toContain('Diamond Sword');
    expect(document.querySelector('.inventory-tooltip')?.textContent)
      .toContain('minecraft:diamond_sword');
    expect(document.querySelector('.inventory-tooltip')?.textContent)
      .toContain('Durability: 0 / 100');
    slot.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(document.querySelector('.inventory-tooltip')).toBeNull();

    slot.focus();
    expect(document.querySelector('.inventory-tooltip')).not.toBeNull();
    screen.close();
  });

  it('uses an atlas texture and handles glint, resolver fallback, and image failure', () => {
    const screen = open(inventory({
      items: [
        item(1, { safeTooltipData: { damage: 0, maxDamage: 0, glint: true } }),
        item(2, { itemId: 'example:laser' }),
      ],
    }));
    const vanilla = document.querySelector<HTMLElement>('[data-slot="1"]')!;
    const image = vanilla.querySelector<HTMLImageElement>('img')!;
    const modded = document.querySelector<HTMLElement>('[data-slot="2"]')!;

    expect(vanilla.classList.contains('has-glint')).toBe(true);
    expect(image.src).toBe('http://localhost:3000/deterministic-items/diamond_sword.png');
    expect(modded.querySelector('.inventory-fallback')?.textContent).toBe('example:laser');
    image.dispatchEvent(new Event('error'));
    expect(vanilla.querySelector('img')).toBeNull();
    expect(vanilla.querySelector('.inventory-fallback')?.textContent).toBe('minecraft:diamond_sword');
    screen.close();
  });

  it('closes with escape, backdrop, and close button while preserving panel clicks and focus', () => {
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const screen = open(inventory({ items: [item(0)] }));
    const close = document.querySelector<HTMLButtonElement>('.inventory-close')!;

    expect(document.activeElement).toBe(close);
    document.querySelector<HTMLElement>('.inventory-panel')!.click();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(before);

    open(inventory());
    document.querySelector<HTMLElement>('.inventory-overlay')!.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    open(inventory());
    document.querySelector<HTMLButtonElement>('.inventory-close')!.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    screen.close();
  });

  it('replaces its prior modal and removes tooltip resources idempotently', () => {
    const screen = open(inventory({ items: [item(0)] }));
    document.querySelector<HTMLElement>('[data-slot="0"]')!.focus();
    expect(document.querySelector('.inventory-tooltip')).not.toBeNull();

    expect(screen.open(inventory({ items: [item(1)] }))).toEqual({ ok: true });
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[data-slot="0"]')).toBeNull();
    expect(document.querySelector('.inventory-tooltip')).toBeNull();
    screen.close();
    screen.close();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('fails closed for invalid data and renders untrusted text as text', () => {
    const screen = new InventoryScreen({ document, atlas: new ItemAtlas('/deterministic-items/') });
    expect(screen.open({ ...inventory(), size: 54 })).toEqual({ ok: false, error: 'invalid_inventory_data' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    open(inventory({ items: [item(0, { displayName: '<img src=x onerror=alert(1)>' })] }));
    expect(document.querySelector('[data-slot="0"] img[src="x"]')).toBeNull();
    document.querySelector<HTMLElement>('[data-slot="0"]')!.focus();
    expect(document.querySelector('.inventory-tooltip')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
