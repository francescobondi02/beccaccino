import { render, screen } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';
import TableCard from '../TableCard';
import { tableLayout } from '@/lib/tableLayout';

it('starts a card centred on its origin point', async () => {
  const layout = tableLayout(732, 353);
  const origin = { x: 100, y: 40 };
  await render(<TableCard image={0} label="carta" index={1} layout={layout} origin={origin} destination={origin}
    collect={new Animated.Value(0)} glow={new Animated.Value(0)} winner={false} reduceMotion progress={new Animated.Value(0)} />);
  const { left, top, width, height, transform } = StyleSheet.flatten(screen.getByLabelText('carta').props.style);
  const shift = Object.assign({}, ...transform);
  expect(left + width / 2 + shift.translateX).toBeCloseTo(origin.x);
  expect(top + height / 2 + shift.translateY).toBeCloseTo(origin.y);
});
