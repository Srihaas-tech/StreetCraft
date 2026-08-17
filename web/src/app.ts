import { Scene } from 'three';
import { streetCraftConfig } from './config';

export function mountStreetCraftApp(container: HTMLElement): void {
  const scene = new Scene();
  const heading = document.createElement('h1');
  heading.textContent = 'StreetCraft';
  const description = document.createElement('p');
  description.textContent = 'Public Street View';

  container.replaceChildren(heading, description);
  container.dataset.blueMapOrigin = streetCraftConfig.blueMapOrigin;
  container.dataset.sceneType = scene.type;
}
