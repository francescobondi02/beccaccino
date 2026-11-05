jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  createAudioPlayer: jest.fn(() => ({ seekTo: jest.fn(() => Promise.resolve()), play: jest.fn() })),
}));
