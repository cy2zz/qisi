import { describe, expect, it } from 'vitest';
import { allowedWebOrigins, isAllowedWebOrigin } from './web-origin.js';

describe('web origin policy', () => {
  it('treats localhost and 127.0.0.1 as aliases on the Vite development port', () => {
    expect(allowedWebOrigins('http://localhost:5173')).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    expect(isAllowedWebOrigin('http://127.0.0.1:5173', 'http://localhost:5173')).toBe(true);
  });

  it('does not broaden a configured production origin or accept another port', () => {
    expect(allowedWebOrigins('https://study.example.com')).toEqual([
      'https://study.example.com',
    ]);
    expect(isAllowedWebOrigin('http://127.0.0.1:5174', 'http://localhost:5173')).toBe(false);
    expect(isAllowedWebOrigin('https://other.example.com', 'https://study.example.com')).toBe(false);
    expect(isAllowedWebOrigin(undefined, 'http://localhost:5173')).toBe(false);
  });
});
