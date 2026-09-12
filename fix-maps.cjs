const fs = require('fs');
const path = require('path');

const filePath = 'app/services/supabase/repositories.ts';
let content = fs.readFileSync(filePath, 'utf8');

const mapClass = `
class FallbackSafeMap<K, V> extends Map<K, V> {
  private assertSafe() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[Supabase Fallback] In-memory persistence fallback is strictly disabled in production.');
    }
  }
  set(key: K, value: V): this {
    this.assertSafe();
    return super.set(key, value);
  }
  get(key: K): V | undefined {
    this.assertSafe();
    return super.get(key);
  }
  values(): IterableIterator<V> {
    this.assertSafe();
    return super.values();
  }
  keys(): IterableIterator<K> {
    this.assertSafe();
    return super.keys();
  }
  has(key: K): boolean {
    this.assertSafe();
    return super.has(key);
  }
  delete(key: K): boolean {
    this.assertSafe();
    return super.delete(key);
  }
  clear(): void {
    this.assertSafe();
    super.clear();
  }
}
`;

if (!content.includes('class FallbackSafeMap')) {
  // insert before export class DefaultRepositoryRegistry
  content = content.replace("export class DefaultRepositoryRegistry", mapClass + "\nexport class DefaultRepositoryRegistry");
  content = content.replace(/new Map\(\)/g, "new FallbackSafeMap()");
  fs.writeFileSync(filePath, content);
  console.log('Repositories updated with FallbackSafeMap');
} else {
  console.log('Already updated');
}

