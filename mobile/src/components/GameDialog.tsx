import type { PropsWithChildren } from 'react';
import { Modal } from 'react-native';
import Sheet from './Sheet';
import useReducedMotion from '@/hooks/useReducedMotion';

// In-game dialogs: a native Modal around the shared sheet. `onClose` (when given) enables X, tap-outside and
// Android back; without it the dialog stays until the game state changes.
export default function GameDialog({ title, visible, onClose, children }: PropsWithChildren<{
  title: string; visible: boolean; onClose?: () => void;
}>) {
  const reduced = useReducedMotion() !== false;
  return (
    <Modal visible={visible} transparent animationType={reduced ? 'none' : 'fade'}
      supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
      <Sheet title={title} onClose={onClose}>{children}</Sheet>
    </Modal>
  );
}
