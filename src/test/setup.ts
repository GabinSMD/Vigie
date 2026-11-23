import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom n'implémente pas le défilement.
if (typeof window !== 'undefined') window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') window.location.hash = '';
});
