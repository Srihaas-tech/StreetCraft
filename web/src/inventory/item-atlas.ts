export type ItemTexture =
  | { kind: 'image'; src: string }
  | { kind: 'fallback'; label: string };

const VANILLA_ITEM_ID = /^[a-z0-9][a-z0-9_./-]*$/;
const DEFAULT_BASE =
  'https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/1.21.1/items/';

export class ItemAtlas {
  private readonly base: string;

  constructor(base = DEFAULT_BASE) {
    this.base = base.endsWith('/') ? base : `${base}/`;
  }

  resolve(itemId: string): ItemTexture {
    const [namespace, path, ...extra] = itemId.split(':');
    if (
      namespace !== 'minecraft' ||
      path === undefined ||
      extra.length !== 0 ||
      !VANILLA_ITEM_ID.test(path) ||
      path.includes('..') ||
      path.includes('/')
    ) {
      return { kind: 'fallback', label: itemId };
    }

    return { kind: 'image', src: `${this.base}${path}.png` };
  }
}
