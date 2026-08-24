// Adds the parts of a DLsite work page the scraper used to throw away:
// the 作者 (author) credit, the 作品内容 description, the sample images and
// the user reviews.
exports.up = async function(knex) {
  const hasAuthor = await knex.schema.hasTable('t_author');
  if (!hasAuthor) {
    await knex.schema.createTable('t_author', (table) => {
      table.string('id'); // UUID v5, based on name
      table.string('name').notNullable();
      table.primary('id');
    });
  }

  const hasAuthorRel = await knex.schema.hasTable('r_author_work');
  if (!hasAuthorRel) {
    await knex.schema.createTable('r_author_work', (table) => {
      table.string('author_id');
      table.string('work_id');
      table.foreign('author_id').references('id').inTable('t_author').onUpdate('CASCADE').onDelete('CASCADE');
      table.foreign('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE');
      table.primary(['author_id', 'work_id']);
    });
  }

  const hasDlsiteReview = await knex.schema.hasTable('t_dlsite_review');
  if (!hasDlsiteReview) {
    await knex.schema.createTable('t_dlsite_review', (table) => {
      // DLsite's own member_review_id. Distinct from t_review, which holds
      // *this server's* users' ratings and progress.
      table.string('id').notNullable();
      table.string('work_id').notNullable();
      table.string('reviewer_id');
      table.string('reviewer_name');
      table.integer('rate'); // 1-5 stars
      table.text('review_title');
      table.text('review_text');
      table.boolean('spoiler');
      table.boolean('recommend');
      table.boolean('is_purchased');
      table.integer('good_review');
      table.integer('bad_review');
      table.text('genres'); // JSON [{id, name}] — genres the reviewer picked
      table.string('entry_date');
      table.string('regist_date');
      table.timestamps(true, true);

      table.foreign('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE');
      table.primary(['id']);
      table.index('work_id');
    });
  }

  const hasDescription = await knex.schema.hasColumn('t_work', 'description');
  if (!hasDescription) {
    await knex.schema.alterTable('t_work', (table) => {
      table.text('description'); // 作品内容 as plain text
      table.text('description_parts'); // JSON: the same block, per-part, incl. the track list
      table.text('sample_images'); // JSON: [{url, thumb, width, height, file}]
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('t_dlsite_review');
  await knex.schema.dropTableIfExists('r_author_work');
  await knex.schema.dropTableIfExists('t_author');

  const hasDescription = await knex.schema.hasColumn('t_work', 'description');
  if (hasDescription) {
    await knex.schema.alterTable('t_work', (table) => {
      table.dropColumn('description');
      table.dropColumn('description_parts');
      table.dropColumn('sample_images');
    });
  }
};
