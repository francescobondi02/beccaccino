import { backendOrigin, productionBackend } from '../backend';

it('uses production when no backend is configured', () => {
  expect(backendOrigin(undefined).origin).toBe(productionBackend);
  expect(backendOrigin(' ').origin).toBe(productionBackend);
  expect(backendOrigin('http://192.168.1.2:8001').origin).toBe('http://192.168.1.2:8001');
});

it.each(['not-a-url', 'ftp://becca.example', 'https://user:pass@becca.example', 'https://becca.example/api'])(
  'rejects an invalid backend origin: %s', (url) => {
    expect(() => backendOrigin(url)).toThrow();
  },
);

it('requires HTTPS in distribution builds', () => {
  const development = __DEV__;
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  try {
    expect(() => backendOrigin('http://becca.example')).toThrow('HTTPS');
  } finally {
    Object.defineProperty(globalThis, '__DEV__', { value: development, configurable: true });
  }
});
