export const slides = (count = 3) => Array.from({length: count}, (_, i) => ({
  id: `page-${i}`, title: `${i + 1}.png`, notes: '',
}));
