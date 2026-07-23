// Community-standard abbreviations for the Trade 1 and Trade 2 tokens. These
// codes are printed on the physical game pieces, so players recognise them at a
// glance — we use them as compact legend labels on phones, where the full names
// wrap to several lines. Keyed by Display Name exactly as it appears in the
// data. Also worth keeping if we ever parse raw auction text, where sellers
// routinely use these codes in listings.
export const TOKEN_ABBREVIATIONS: Record<string, string> = {
  // Trade 1
  "Alchemist's Ink": 'AI',
  'Dwarven Steel': 'DS',
  'Mystic Silk': 'MS',
  "Enchanter's Munition": 'EM',
  'Minotaur Hide': 'MH',
  "Alchemist's Parchment": 'AP',
  "Philosopher's Stone": 'PS',
  'Darkwood Plank': 'DP',
  // Trade 2
  'Oil of Enchantment': 'OE',
  '1,000 GP Gold Bar': '1k Bar',
  'Elven Bismuth': 'EB',
  Aragonite: 'AG',
};
