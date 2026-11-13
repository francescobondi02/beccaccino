import type { ImageSourcePropType } from 'react-native';
import type { Card } from '@contract/cards';

const images: Record<Card['suit'], Record<Card['value'], ImageSourcePropType>> = {
  denara: {
    asso: require('../../assets/cards/asso_denari.png'), due: require('../../assets/cards/due_denari.png'),
    tre: require('../../assets/cards/tre_denari.png'), quattro: require('../../assets/cards/quattro_denari.png'),
    cinque: require('../../assets/cards/cinque_denari.png'), sei: require('../../assets/cards/sei_denari.png'),
    sette: require('../../assets/cards/sette_denari.png'), fante: require('../../assets/cards/fante_denari.png'),
    cavallo: require('../../assets/cards/cavallo_denari.png'), re: require('../../assets/cards/re_denari.png'),
  },
  coppe: {
    asso: require('../../assets/cards/asso_coppe.png'), due: require('../../assets/cards/due_coppe.png'),
    tre: require('../../assets/cards/tre_coppe.png'), quattro: require('../../assets/cards/quattro_coppe.png'),
    cinque: require('../../assets/cards/cinque_coppe.png'), sei: require('../../assets/cards/sei_coppe.png'),
    sette: require('../../assets/cards/sette_coppe.png'), fante: require('../../assets/cards/fante_coppe.png'),
    cavallo: require('../../assets/cards/cavallo_coppe.png'), re: require('../../assets/cards/re_coppe.png'),
  },
  spade: {
    asso: require('../../assets/cards/asso_spade.png'), due: require('../../assets/cards/due_spade.png'),
    tre: require('../../assets/cards/tre_spade.png'), quattro: require('../../assets/cards/quattro_spade.png'),
    cinque: require('../../assets/cards/cinque_spade.png'), sei: require('../../assets/cards/sei_spade.png'),
    sette: require('../../assets/cards/sette_spade.png'), fante: require('../../assets/cards/fante_spade.png'),
    cavallo: require('../../assets/cards/cavallo_spade.png'), re: require('../../assets/cards/re_spade.png'),
  },
  bastoni: {
    asso: require('../../assets/cards/asso_bastoni.png'), due: require('../../assets/cards/due_bastoni.png'),
    tre: require('../../assets/cards/tre_bastoni.png'), quattro: require('../../assets/cards/quattro_bastoni.png'),
    cinque: require('../../assets/cards/cinque_bastoni.png'), sei: require('../../assets/cards/sei_bastoni.png'),
    sette: require('../../assets/cards/sette_bastoni.png'), fante: require('../../assets/cards/fante_bastoni.png'),
    cavallo: require('../../assets/cards/cavallo_bastoni.png'), re: require('../../assets/cards/re_bastoni.png'),
  },
};

export function cardImage(card: Card): ImageSourcePropType { return images[card.suit][card.value]; }
