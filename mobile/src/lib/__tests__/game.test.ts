import { displayName } from '../game';

it('shows bots without their account suffix', () => {
  expect(['Socio', 'Forte (bot)'].map(displayName)).toEqual(['Socio', 'Forte']);
});
