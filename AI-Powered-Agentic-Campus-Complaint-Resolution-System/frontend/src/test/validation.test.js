import { describe, it, expect } from 'vitest';
import { validateRegistration, validateComplaint } from '../validation';

describe('registration validation', () => {
  it('mirrors the API password rule', () => {
    expect(validateRegistration({ name: 'Al Ng', email: 'a@b.co', password: 'abcdefgh', confirm: 'abcdefgh' }).password).toMatch(/letter and one number/);
    expect(validateRegistration({ name: 'Al Ng', email: 'a@b.co', password: 'abcdefg1', confirm: 'abcdefg1' })).toEqual({});
    expect(validateRegistration({ name: 'A', email: 'nope', password: 'x', confirm: 'y' })).toMatchObject({ name: expect.any(String), email: expect.any(String), password: expect.any(String), confirm: expect.any(String) });
  });
});

describe('complaint validation', () => {
  const ok = { title: 'Wi-Fi down', description: 'It has been down since this morning.', categoryId: 'c', locationId: 'l', file: null };
  it('accepts a valid complaint and enforces minimum lengths', () => {
    expect(validateComplaint(ok)).toEqual({});
    expect(validateComplaint({ ...ok, title: 'Wifi', description: 'short' })).toMatchObject({ title: expect.any(String), description: expect.any(String) });
  });
  it('rejects non-images and files over 5 MB', () => {
    expect(validateComplaint({ ...ok, file: { type: 'application/pdf', size: 10 } }).attachment).toMatch(/JPEG/);
    expect(validateComplaint({ ...ok, file: { type: 'image/png', size: 6 * 1024 * 1024 } }).attachment).toMatch(/5 MB/);
  });
});
