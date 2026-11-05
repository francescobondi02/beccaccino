import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

const sources = {
  tap: require('../../assets/sounds/tap.wav'),
  card: require('../../assets/sounds/card.wav'),
  trick: require('../../assets/sounds/trick.wav'),
  turn: require('../../assets/sounds/turn.wav'),
  win: require('../../assets/sounds/win.wav'),
} as const;
export type Sound = keyof typeof sources;

const preference = 'becca.sound';
const players: Partial<Record<Sound, AudioPlayer>> = {};
const listeners = new Set<() => void>();
let enabled = true;
const warn = (error: unknown) => console.warn('Sound unavailable', error);

// Short effects mixed with other apps' audio; they follow the iPhone silent switch.
export async function initSound() {
  try {
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
    enabled = (await SecureStore.getItemAsync(preference)) !== 'off';
    listeners.forEach((listener) => listener());
  } catch (error) { warn(error); }
}

export function playSound(name: Sound) {
  if (!enabled || AppState.currentState !== 'active') return;
  try {
    const player = players[name] ??= createAudioPlayer(sources[name]);
    void player.seekTo(0).then(() => player.play()).catch(warn);
  } catch (error) { warn(error); }
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  listeners.forEach((listener) => listener());
  void SecureStore.setItemAsync(preference, on ? 'on' : 'off').catch(warn);
}

export function useSoundEnabled() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => enabled);
}
