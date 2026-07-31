const strftime  = require('./strftime');

// Normalize API endpoints
const normalize = (works, options = {}) => {
  works.map(record => {
    record.nsfw = Boolean(record.nsfw);
    record.circle = JSON.parse(record.circleObj);
    record.rate_count_detail = JSON.parse(record.rate_count_detail);
    record.rank = record.rank ? JSON.parse(record.rank) : null;

    // Open-source schema: tagObj/vaObj from staticMetadata view
    if (record.tagObj) {
      const parsed = JSON.parse(record.tagObj);
      record.tags = parsed.tags || [];
    } else {
      // Closed-source upstream schema: tagNames/tagIds
      const tagNames = record.tagNames ? JSON.parse(record.tagNames) : [];
      const tagIds = record.tagIds ? JSON.parse(record.tagIds) : [];
      record.tags = tagNames.map((name, i) => ({
        id: tagIds[i],
        name: name
      }));
    }

    if (record.vaObj) {
      const parsed = JSON.parse(record.vaObj);
      record.vas = parsed.vas || [];
    } else {
      const vaNames = record.vaNames ? JSON.parse(record.vaNames) : [];
      const vaIds = record.vaIds ? JSON.parse(record.vaIds) : [];
      record.vas = vaNames.map((name, i) => ({
        id: vaIds[i],
        name: name
      }));
    }
    if (record.illustratorObj) {
      const parsed = JSON.parse(record.illustratorObj);
      record.illustrators = parsed.illustrators || [];
    } else {
      record.illustrators = [];
    }

    if (record.scriptWriterObj) {
      const parsed = JSON.parse(record.scriptWriterObj);
      record.scriptWriters = parsed.scriptWriters || [];
    } else {
      record.scriptWriters = [];
    }

    if (record.seriesObj) {
      const parsed = JSON.parse(record.seriesObj);
      record.series = parsed.series && parsed.series.length > 0 ? parsed.series[0] : null;
    } else {
      record.series = null;
    }

    if (record.hasOwnProperty("state")) {
      record.state = JSON.parse(record.state);
      record.play_updated_at = strftime('%F', record.play_updated_at);
    }
    delete record.circleObj;
    delete record.tagObj;
    delete record.vaObj;
    delete record.illustratorObj;
    delete record.scriptWriterObj;
    delete record.seriesObj;
    delete record.tagNames;
    delete record.tagIds;
    delete record.vaNames;
    delete record.vaIds;
    if (options.dateOnly && record.updated_at) {
      record.updated_at = strftime('%F', record.updated_at);
    }
  });
  return works;
};

module.exports = normalize;
