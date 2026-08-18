import type { ItemAtlas } from './item-atlas';

export interface ItemData {
  slot: number;
  itemId: string;
  count: number;
  displayName: string;
  safeTooltipData: {
    damage: number;
    maxDamage: number;
    glint: boolean;
  };
}

export interface InventoryData {
  containerType: 'chest' | 'barrel' | 'shulker_box' | 'double_chest';
  size: number;
  items: ItemData[];
}

export type OpenResult = { ok: true } | { ok: false; error: string };

export class InventoryScreen {
  private container: HTMLElement | null = null;
  private tooltip: HTMLElement | null = null;
  private readonly document: Document;
  private readonly atlas: ItemAtlas;
  private lastFocusedElement: HTMLElement | null = null;

  constructor(options: { document: Document; atlas: ItemAtlas }) {
    this.document = options.document;
    this.atlas = options.atlas;
  }

  open(data: InventoryData): OpenResult {
    const expectedSize = data.containerType === 'double_chest' ? 54 : 27;
    if (data.size !== expectedSize) {
      this.close();
      return { ok: false, error: 'invalid_inventory_data' };
    }

    this.close();
    this.lastFocusedElement = this.document.activeElement as HTMLElement;

    const overlay = this.document.createElement('div');
    overlay.className = 'inventory-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    const panel = this.document.createElement('div');
    panel.className = 'inventory-panel';
    overlay.appendChild(panel);

    const header = this.document.createElement('div');
    header.className = 'inventory-header';
    const title = this.document.createElement('h2');
    title.textContent = this.getContainerTitle(data.containerType);
    header.appendChild(title);

    const closeBtn = this.document.createElement('button');
    closeBtn.className = 'inventory-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close inventory');
    closeBtn.onclick = () => this.close();
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const grid = this.document.createElement('div');
    grid.className = `inventory-grid type-${data.containerType.replace('_', '-')}`;
    
    const itemsBySlot = new Map(data.items.map(item => [item.slot, item]));

    for (let i = 0; i < data.size; i++) {
      const slot = this.document.createElement('div');
      slot.className = 'inventory-slot';
      slot.setAttribute('data-slot', i.toString());
      slot.setAttribute('tabindex', '0');

      const item = itemsBySlot.get(i);
      if (item) {
        this.renderItem(slot, item);
      }

      slot.addEventListener('mouseenter', () => this.showTooltip(slot, item));
      slot.addEventListener('mouseleave', () => this.hideTooltip());
      slot.addEventListener('focus', () => this.showTooltip(slot, item));
      slot.addEventListener('blur', () => this.hideTooltip());

      grid.appendChild(slot);
    }
    panel.appendChild(grid);

    this.document.body.appendChild(overlay);
    this.container = overlay;

    this.document.addEventListener('keydown', this.handleKeyDown);

    closeBtn.focus();

    return { ok: true };
  }

  private getContainerTitle(type: InventoryData['containerType']): string {
    switch (type) {
      case 'chest': return 'Chest';
      case 'barrel': return 'Barrel';
      case 'shulker_box': return 'Shulker Box';
      case 'double_chest': return 'Large Chest';
    }
  }

  private renderItem(slot: HTMLElement, item: ItemData) {
    slot.setAttribute('aria-label', `${item.displayName} x${item.count}`);
    if (item.safeTooltipData.glint) {
      slot.classList.add('has-glint');
    }

    const texture = this.atlas.resolve(item.itemId);
    if (texture.kind === 'image') {
      const img = this.document.createElement('img');
      img.src = texture.src;
      img.alt = '';
      img.onerror = () => {
        img.remove();
        this.renderFallback(slot, item.itemId);
      };
      slot.appendChild(img);
    } else {
      this.renderFallback(slot, item.itemId);
    }

    if (item.count > 1) {
      const count = this.document.createElement('span');
      count.className = 'inventory-count';
      count.textContent = item.count.toString();
      slot.appendChild(count);
    }
  }

  private renderFallback(slot: HTMLElement, itemId: string) {
    const fallback = this.document.createElement('span');
    fallback.className = 'inventory-fallback';
    fallback.textContent = itemId;
    slot.appendChild(fallback);
  }

  private showTooltip(slot: HTMLElement, item: ItemData | undefined) {
    this.hideTooltip();
    if (!item) return;

    const tooltip = this.document.createElement('div');
    tooltip.className = 'inventory-tooltip';
    
    const name = this.document.createElement('div');
    name.className = 'tooltip-name';
    name.textContent = item.displayName;
    tooltip.appendChild(name);

    const id = this.document.createElement('div');
    id.className = 'tooltip-id';
    id.textContent = item.itemId;
    tooltip.appendChild(id);

    if (item.safeTooltipData.maxDamage > 0) {
      const durability = this.document.createElement('div');
      durability.className = 'tooltip-durability';
      const current = Math.max(0, item.safeTooltipData.maxDamage - item.safeTooltipData.damage);
      durability.textContent = `Durability: ${current} / ${item.safeTooltipData.maxDamage}`;
      tooltip.appendChild(durability);
    }

    this.document.body.appendChild(tooltip);
    this.tooltip = tooltip;

    const rect = slot.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top}px`;
  }

  private hideTooltip() {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
  }

  close() {
    this.hideTooltip();
    if (this.container) {
      this.container.remove();
      this.container = null;
      this.document.removeEventListener('keydown', this.handleKeyDown);
      if (this.lastFocusedElement) {
        this.lastFocusedElement.focus();
      }
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.close();
    }
  };
}
