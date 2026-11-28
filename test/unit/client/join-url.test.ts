import { describe, expect, it } from 'vitest';
import { codeFromPath, displayCodeFromPath, displayUrl, isLoopbackOrigin, joinUrl } from '../../../src/client/lobby/join-url';

describe('join link and loopback warning (stage 4.10.3)', () => {
  it('builds the link from the page origin', () => {
    expect(joinUrl('https://sketchy.example.workers.dev', 'abcd')).toBe('https://sketchy.example.workers.dev/join/ABCD');
    expect(joinUrl('http://192.168.1.20:8787/', 'WXYZ')).toBe('http://192.168.1.20:8787/join/WXYZ');
  });

  it('warns for loopback origins only', () => {
    for (const o of ['http://localhost:5173', 'http://127.0.0.1:8799', 'http://127.1.2.3', 'http://[::1]:8787', 'http://app.localhost', 'http://0.0.0.0:8787']) {
      expect(isLoopbackOrigin(o), o).toBe(true);
    }
    for (const o of ['https://sketchy.example.workers.dev', 'http://192.168.1.20:8787', 'http://10.0.0.5', 'http://localhost.example.com', 'not a url']) {
      expect(isLoopbackOrigin(o), o).toBe(false);
    }
  });

  it('reads the code from /join/<code> only', () => {
    expect(codeFromPath('/join/abcd')).toBe('ABCD');
    expect(codeFromPath('/join/ABCD/')).toBe('ABCD');
    expect(codeFromPath('/')).toBeNull();
    expect(codeFromPath('/join/')).toBeNull();
    expect(codeFromPath('/join/AB1D')).toBeNull();
    expect(codeFromPath('/api/room')).toBeNull();
  });

  it('builds and reads the big-screen display path (12.4)', () => {
    expect(displayUrl('https://sketchy.example.workers.dev/', 'abcd')).toBe('https://sketchy.example.workers.dev/display/ABCD');
    expect(displayCodeFromPath('/display/abcd')).toBe('ABCD');
    expect(displayCodeFromPath('/display/ABCD/')).toBe('ABCD');
    expect(displayCodeFromPath('/join/ABCD')).toBeNull();
    expect(displayCodeFromPath('/display/')).toBeNull();
    expect(codeFromPath('/display/ABCD')).toBeNull();
  });
});
