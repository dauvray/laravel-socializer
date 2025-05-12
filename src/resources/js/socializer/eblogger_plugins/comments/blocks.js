export default (editor, opts = {}) => {
  const bm = editor.BlockManager;

  bm.add('comments-block', {
    label: 'Commentaires',
    category: 'Composants',
    content: `<x-socializer::comments-list></x-socializer::comments-list>`,
    media: '<i class="lar la-comments"></i>',
  });
}
