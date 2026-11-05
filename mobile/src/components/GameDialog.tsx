import type { PropsWithChildren } from 'react';
import { Modal } from 'react-native';
import Sheet from './Sheet';
import useReducedMotion from '@/hooks/useReducedMotion';

// In-game dialogs: a native Modal around the shared sheet. `onClose` (when given) enables X and tap-outside.
export default function GameDialog({ title, visible, onClose, dismissable = true, children }: PropsWithChildren<{
  title: string; visible: boolean; onClose: () => void; dismissable?: boolean;
}>) {
  const reduced = useReducedMotion() !== false;
  return (
    <Modal visible={visible} transparent animationType={reduced ? 'none' : 'fade'}
      supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
      <Sheet title={title} onClose={dismissable ? onClose : undefined}>{children}</Sheet>
    </Modal>
  );
}
