import { useRouter } from 'expo-router';

// Goes back when the screen was opened from inside the app, home when it was opened directly.
export default function useCloseOrHome() {
  const router = useRouter();
  return () => router.canGoBack() ? router.back() : router.replace('/');
}
