import { checkBackendReadiness } from '../backend';

const fetchMock = jest.fn();
const signal = new AbortController().signal;

beforeEach(() => {
  jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
});

afterEach(() => {
  jest.restoreAllMocks();
  fetchMock.mockReset();
});

it('checks the existing readiness endpoint and passes cancellation through', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'ready' }) });
  await expect(checkBackendReadiness('https://becca.example/', signal)).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledWith('https://becca.example/ready', { signal });
});

it.each([undefined, '', 'not-a-url', 'ftp://becca.example', 'https://user:secret@becca.example', 'https://becca.example/api'])(
  'rejects invalid backend configuration before making a request: %s',
  async (url) => {
    await expect(checkBackendReadiness(url, signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it('reports an unavailable backend instead of treating its response as success', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 503 });
  await expect(checkBackendReadiness('https://becca.example', signal)).rejects.toThrow('HTTP 503');
});

it('rejects a response that does not match the readiness contract', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });
  await expect(checkBackendReadiness('https://becca.example', signal)).rejects.toThrow('risposta non riconosciuta');
});

it('propagates network failures for the screen to display', async () => {
  fetchMock.mockRejectedValue(new Error('Network request failed'));
  await expect(checkBackendReadiness('https://becca.example', signal)).rejects.toThrow('Network request failed');
});

it('requires HTTPS in distribution builds before sending a request', async () => {
  const development = __DEV__;
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  try {
    await expect(checkBackendReadiness('http://becca.example', signal)).rejects.toThrow('HTTPS');
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(globalThis, '__DEV__', { value: development, configurable: true });
  }
});
