/**
 * Five progress states collapse to three: 想听 (marked), 听过 (listened),
 * 搁置 (postponed).
 *
 * 重听 (replay) meant "listen again", which is what 想听 already says about a
 * work you own — it folds into marked. 在听 (listening) was only ever set by
 * hand and duplicates what play history already records (a work with a history
 * row is by definition in progress), so it clears to NULL — i.e. unmarked for
 * the list filter, while the history row itself is untouched.
 *
 * The merge is lossy: replay and listening are indistinguishable afterwards.
 * That is the point of the change, so down() only restores the vocabulary.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('t_review'))) return;
  await knex('t_review').where('progress', 'replay').update({ progress: 'marked' });
  await knex('t_review').where('progress', 'listening').update({ progress: null });
};

exports.down = async function () {
  // replayed -> marked and listening -> NULL cannot be reversed.
};
