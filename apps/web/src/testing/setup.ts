import { afterEach } from 'vitest';

// Testing Library only cleans up automatically when test globals are enabled; they are not here.
afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
