import { createAudioPlayer } from 'expo-audio';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { initSound, playSound, setSoundEnabled } from '../sound';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(() => Promise.resolve()) }));

beforeEach(() => { jest.clearAllMocks(); AppState.currentState = 'active'; });

it('restores the saved preference, stays silent when off and persists changes', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('off');
  await initSound();
  playSound('card');
  expect(createAudioPlayer).not.toHaveBeenCalled();

  setSoundEnabled(true);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('becca.sound', 'on');
  playSound('card');
  playSound('card');
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);
});
