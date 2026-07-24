const strftime  = require('./strftime')

// Normalize API endpoints
const normalize = (works, options = {}) => {
  works.map(record => {
    record.nsfw = Boolean(record.nsfw);
    record.circle = JSON.parse(record.circleObj);
    record.rate_count_detail = JSON.parse(record.rate_count_detail);
    record.rank = record.rank ? JSON.parse(record.rank) : null;

    // New schema for closed source upstream: tagNames/tagIds and vaNames/vaIds instead of tagObj/vaObj
    const tagNames = record.tagNames ? JSON.parse(record.tagNames) : [];
    const tagIds = record.tagIds ? JSON.parse(record.tagIds) : [];
    record.tags = tagNames.map((name, i) => ({
      id: tagIds[i],
      name: name
    }));

    const vaNames = record.vaNames ? JSON.parse(record.vaNames) : [];
    const vaIds = record.vaIds ? JSON.parse(record.vaIds) : [];
    record.vas = vaNames.map((name, i) => ({
      id: vaIds[i],
      name: name
    }));
    if (record.hasOwnProperty("state")) {
      record.state = JSON.parse(record.state);
      record.play_updated_at = strftime('%F', record.play_updated_at)
    }
    delete record.circleObj;
    delete record.tagNames;
    delete record.tagIds;
    delete record.vaNames;
    delete record.vaIds;
    if (options.dateOnly && record.updated_at) {
      record.updated_at = strftime('%F', record.updated_at);
    }
  })
  return works
}

module.exports = normalize;
