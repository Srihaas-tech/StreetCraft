import { mountStreetCraftApp } from './app';

const appRoot = document.querySelector<HTMLElement>('#app');

if (appRoot === null) {
  throw new Error('StreetCraft requires an #app element.');
}

mountStreetCraftApp(appRoot);
