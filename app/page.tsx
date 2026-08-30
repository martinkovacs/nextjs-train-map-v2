import { App } from '@/components/App';

/** The map is the product: one client shell over the whole viewport. Everything below it
 *  is client-side (Leaflet touches `window` at import), so this page exists only to mount
 *  it. */
export default function Home() {
  return <App />;
}
